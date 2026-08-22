"""认证接口：login/logout/me/修改密码/找回密码/注册/验证码（《后端API设计.md》§1、本轮需求）。

安全规则：
- 登录连续失败 3 次（10 分钟窗口）→ 需输入 4 位数字+字母验证码（内存态，单进程部署）
- 找回密码：system 配置 auth.forgot_method = email（SMTP 发码）/ phone（展示管理员电话）/ both
- 注册：system 配置 auth.register_mode = open（直接建用户，默认"使用者"角色）/ closed（拒绝）/ review（进审核队列）
"""
from __future__ import annotations

import base64
import io
import logging
import random
import string
import threading
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.cache import session_delete, session_delete_all, session_set
from app.core.deps import SUPER_ADMIN_ROLE_CODE, _session_expire_hours, get_current_user
from app.core.response import BizError, E_CAPTCHA, E_LOGIN_FAILED, E_PARAM, E_RATE_LIMITED, ok
from app.core.security import generate_session_token, hash_password, verify_password
from app.db import get_db
from app.models.sys import (
    SysConfig,
    SysPermission,
    SysRegisterApply,
    SysRole,
    SysRolePermission,
    SysSession,
    SysUser,
)
from app.schemas.auth import (
    ForgotReq,
    LoginReq,
    PasswordReq,
    RegisterReq,
    ResetReq,
    RoleInfo,
    UserInfo,
)
from app.services.mail import send_reset_code

logger = logging.getLogger("app.auth")

router = APIRouter(prefix="/auth", tags=["认证"])

# ---------- 内存态（单进程部署；验证码/失败计数/重置码） ----------
_lock = threading.Lock()
_login_fail: dict[str, list] = {}  # username -> [fail_count, first_fail_ts]
_captchas: dict[str, tuple[str, float]] = {}  # captcha_id -> (code, expire_ts)
_reset_codes: dict[str, tuple[str, float]] = {}  # username -> (code, expire_ts)
_reset_fail: dict[str, int] = {}  # username -> 连续验证失败次数（防重置码爆破）
_mail_quota: dict[str, list[float]] = {}  # 找回密码发信时间戳（防邮件轰炸）
_register_quota: dict[str, list[float]] = {}  # 注册请求时间戳（防批量注册）

# 内存态有界保护：防止攻击者反复触发验证码/重置码/失败计数导致字典无界增长
_MAX_CAPTCHAS = 500
_MAX_RESET_CODES = 500
_MAX_LOGIN_FAIL_KEYS = 2000
_MAX_MAIL_KEYS = 2000
_MAX_REGISTER_KEYS = 2000

FAIL_LIMIT = 3  # 连续失败 3 次后要求验证码
FAIL_WINDOW = 600  # 失败计数窗口（秒）
CAPTCHA_TTL = 300
RESET_TTL = 900
_CAPTCHA_CHARS = string.digits + string.ascii_uppercase
_CAPTCHA_BLACKLIST = set("0O1lI")

REGISTER_ROLE_CODE = "user"  # 开放注册默认角色：使用者


def _drop_expired_ts(bucket: dict[str, list[float]], window: float) -> None:
    """按窗口清理时间戳桶中的过期项；空桶一并删除。"""
    cutoff = time.time() - window
    for key in list(bucket.keys()):
        bucket[key] = [ts for ts in bucket[key] if ts > cutoff]
        if not bucket[key]:
            del bucket[key]


def _cleanup_mem_state() -> None:
    """惰性清理过期的验证码/重置码/失败计数，保证内存态有界。

    在各公开入口处调用（单进程内存表规模很小，O(n) 清理可接受）。
    """
    now = time.time()
    for key in list(_captchas.keys()):
        if _captchas[key][1] <= now:
            del _captchas[key]
    for key in list(_reset_codes.keys()):
        if _reset_codes[key][1] <= now:
            _reset_codes.pop(key, None)
            _reset_fail.pop(key, None)
    for key in list(_login_fail.keys()):
        if now - _login_fail[key][1] > FAIL_WINDOW:
            del _login_fail[key]


def _cfg(db: Session, key: str, default: str = "") -> str:
    row = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    return row.config_value if row and row.config_value else default


def _need_captcha(username: str) -> bool:
    with _lock:
        rec = _login_fail.get(username)
        if not rec:
            return False
        count, first = rec
        if time.time() - first > FAIL_WINDOW:
            del _login_fail[username]
            return False
        return count >= FAIL_LIMIT


def _bump_fail(username: str) -> None:
    with _lock:
        now = time.time()
        if len(_login_fail) > _MAX_LOGIN_FAIL_KEYS:
            _cleanup_mem_state()
            while len(_login_fail) > _MAX_LOGIN_FAIL_KEYS:
                oldest = min(_login_fail, key=lambda k: _login_fail[k][1])
                del _login_fail[oldest]
        rec = _login_fail.get(username)
        if not rec or now - rec[1] > FAIL_WINDOW:
            _login_fail[username] = [1, now]
        else:
            rec[0] += 1


def _clear_fail(username: str) -> None:
    with _lock:
        _login_fail.pop(username, None)


def _gen_captcha_code() -> str:
    chars = [c for c in _CAPTCHA_CHARS if c not in _CAPTCHA_BLACKLIST]
    return "".join(random.choices(chars, k=4))


def _gen_reset_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _permission_codes(db: Session, user: SysUser) -> list[str]:
    """返回用户权限点 code 列表；超级管理员返回全部。

    模块权限点过滤（线缆和设备插件方案 §13.1.5）：module_code 非空且模块未启用 → 权限点不生效
    （禁用模块后按钮级权限自动失效；模块数据仍由 require_module_enabled 在接口层兜底 403）。
    """
    from app.core.modules import enabled_module_codes

    enabled_mods = enabled_module_codes(db)
    role = db.get(SysRole, user.role_id)
    if role and role.code == SUPER_ADMIN_ROLE_CODE:
        rows = db.scalars(
            select(SysPermission).order_by(SysPermission.id)
        ).all()
    else:
        rows = db.scalars(
            select(SysPermission)
            .join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
            .where(SysRolePermission.role_id == user.role_id)
            .order_by(SysPermission.id)
        ).all()
    return [
        p.code for p in rows
        if not p.module_code or p.module_code in enabled_mods
    ]


def build_user_info(db: Session, user: SysUser) -> UserInfo:
    role = db.get(SysRole, user.role_id)
    return UserInfo(
        id=user.id,
        username=user.username,
        real_name=user.real_name,
        role=RoleInfo(id=role.id, code=role.code, name=role.name) if role else None,
        permissions=_permission_codes(db, user),
    )


# ============================ 验证码 ============================


@router.get("/captcha")
def captcha() -> dict:
    """生成 4 位数字+英文字母验证码（图片 base64，5 分钟有效）。"""
    code = _gen_captcha_code()
    captcha_id = generate_session_token()[:24]
    with _lock:
        _cleanup_mem_state()
        if len(_captchas) >= _MAX_CAPTCHAS:
            # 防止验证码表被刷爆：淘汰最早的 20%
            for stale in sorted(_captchas, key=lambda k: _captchas[k][1])[:_MAX_CAPTCHAS // 5]:
                del _captchas[stale]
        _captchas[captcha_id] = (code, time.time() + CAPTCHA_TTL)
    img = Image.new("RGB", (128, 44), (245, 247, 250))
    draw = ImageDraw.Draw(img)
    for _ in range(70):  # 噪点
        x, y = random.randint(0, 127), random.randint(0, 43)
        draw.point((x, y), fill=(170 + random.randint(0, 70),) * 3)
    for i, ch in enumerate(code):
        draw.text((12 + i * 28, 11), ch, fill=(25 + random.randint(0, 60), 45 + random.randint(0, 50), 110 + random.randint(0, 90)))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return ok({"captcha_id": captcha_id, "image": base64.b64encode(buf.getvalue()).decode()})


def _verify_captcha(captcha_id: str, captcha_code: str) -> None:
    """需要验证码时校验；失败抛 E_CAPTCHA（前端刷新验证码）。"""
    with _lock:
        _cleanup_mem_state()
        rec = _captchas.pop(captcha_id, None)
    if not rec or time.time() > rec[1]:
        raise BizError(E_CAPTCHA, "验证码已过期，请刷新后重试")
    if rec[0].lower() != captcha_code.strip().lower():
        raise BizError(E_CAPTCHA, "验证码错误")


# ============================ 登录/登出/我 ============================


@router.post("/login")
def login(req: LoginReq, response: Response, db: Session = Depends(get_db)) -> dict:
    need = _need_captcha(req.username)
    if need:
        if not req.captcha_id or not req.captcha_code:
            raise BizError(E_CAPTCHA, "连续登录失败，请输入验证码")
        _verify_captcha(req.captcha_id, req.captcha_code)

    user = db.scalar(select(SysUser).where(SysUser.username == req.username))
    if not user or not verify_password(req.password, user.password_hash):
        _bump_fail(req.username)
        logger.warning("登录失败：用户名或密码错误 user=%s", req.username)
        raise BizError(E_LOGIN_FAILED, "用户名或密码错误")
    if user.status != 1:
        _bump_fail(req.username)
        logger.warning("登录失败：账号已停用 user=%s", req.username)
        raise BizError(E_LOGIN_FAILED, "账号已停用")
    _clear_fail(req.username)
    logger.info("登录成功 user=%s", req.username)

    # 记住登录状态：勾选 → 长会话（默认 30 天）；未勾选 → 普通会话（系统设置可调，默认 8 小时）
    session_hours = settings.session_remember_hours if req.remember else _session_expire_hours(db)

    token = generate_session_token()
    db.add(
        SysSession(
            session_id=token,
            user_id=user.id,
            expire_at=datetime.now() + timedelta(hours=session_hours),
        )
    )
    user.last_login_at = datetime.now()
    db.commit()
    # 双写 Redis：后续请求走缓存快路径（token→user_id，TTL=会话时长，meta=总会话时长供滑动续期）
    session_set(token, user.id, int(session_hours * 3600), int(session_hours * 3600))

    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=int(session_hours * 3600),
    )
    return ok({"user": build_user_info(db, user)})


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        db.execute(SysSession.__table__.delete().where(SysSession.session_id == token))
        db.commit()
        session_delete(token)  # 同步删除 Redis 会话
    response.delete_cookie(settings.session_cookie_name)
    return ok()


@router.get("/me")
def me(user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return ok({"user": build_user_info(db, user)})


# ============================ 修改密码 ============================


@router.put("/password")
def change_password(
    req: PasswordReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not verify_password(req.old_password, user.password_hash):
        raise BizError(E_PARAM, "原密码不正确")
    if req.old_password == req.new_password:
        raise BizError(E_PARAM, "新密码不能与原密码相同")
    user.password_hash = hash_password(req.new_password)
    # 改密后使该用户全部会话失效（含当前会话，需重新登录）
    db.execute(
        SysSession.__table__.delete().where(SysSession.user_id == user.id)
    )
    db.commit()
    session_delete_all(user.id)  # Redis 同步失效该用户全部会话
    return ok()


# ============================ 找回密码 ============================


@router.post("/forgot")
def forgot(req: ForgotReq, request: Request, db: Session = Depends(get_db)) -> dict:
    """按系统配置的找回方式处理：email 发重置码 / phone 返回管理员电话。

    防用户名枚举：账号不存在/停用/邮箱不匹配时返回与成功流程同构的响应，不泄露账号状态。
    防滥用：每 IP 10 分钟最多 3 次找回请求；同一账号发信冷却 60 秒（防邮件轰炸）。
    """
    ip = request.client.host if request.client else "unknown"
    with _lock:
        _cleanup_mem_state()
        _drop_expired_ts(_mail_quota, 600)
        if len(_mail_quota.get(ip, [])) >= 3:
            raise BizError(E_RATE_LIMITED, "操作过于频繁，请稍后再试")
    method = _cfg(db, "auth.forgot_method", "phone")
    user = db.scalar(select(SysUser).where(SysUser.username == req.username))
    if user is None or user.status != 1:
        return _forgot_public_reply(db, method)

    if method in ("email", "both") and req.email and req.email.lower() == user.email.lower():
        with _lock:
            if time.time() - max(_mail_quota.get(req.username, [0]), default=0) < 60:
                # 同一账号 60 秒内已发过重置码：统一按成功响应返回，不暴露冷却状态
                return ok({"method": "email", "message": "重置验证码已发送至注册邮箱（15 分钟内有效）"})
            code = _gen_reset_code()
            if len(_reset_codes) >= _MAX_RESET_CODES:
                _cleanup_mem_state()
                while len(_reset_codes) >= _MAX_RESET_CODES:
                    oldest = min(_reset_codes, key=lambda k: _reset_codes[k][1])
                    _reset_codes.pop(oldest, None)
                    _reset_fail.pop(oldest, None)
            _reset_codes[req.username] = (code, time.time() + RESET_TTL)
            _reset_fail.pop(req.username, None)
            _mail_quota.setdefault(req.username, []).append(time.time())
            if len(_mail_quota) > _MAX_MAIL_KEYS:
                _drop_expired_ts(_mail_quota, 600)
                while len(_mail_quota) > _MAX_MAIL_KEYS:
                    oldest = min(_mail_quota, key=lambda k: (_mail_quota[k][-1] if _mail_quota[k] else 0))
                    del _mail_quota[oldest]
        with _lock:
            _mail_quota.setdefault(ip, []).append(time.time())
        send_reset_code(db, user.email, req.username, code)
        return ok({"method": "email", "message": "重置验证码已发送至注册邮箱（15 分钟内有效）"})
    if method == "email":
        # 邮箱不匹配：与账号不存在返回完全一致的响应
        return _forgot_public_reply(db, method)

    phone = _cfg(db, "site.contact_phone")
    if not phone:
        raise BizError(E_PARAM, "系统未配置管理员联系电话，请联系管理员处理")
    return ok({"method": "phone", "contact_phone": phone, "message": "请致电管理员验证身份后重置密码"})


def _forgot_public_reply(db: Session, method: str) -> dict:
    """账号不存在/停用/邮箱不匹配时统一的对外响应（防枚举，与失败场景完全同构）。"""
    if method in ("email", "both"):
        return ok({"method": "email", "message": "如账号与邮箱匹配，重置验证码将发送至注册邮箱（15 分钟内有效）"})
    phone = _cfg(db, "site.contact_phone", "")
    if not phone:
        # 与账号存在且未配置电话时的响应完全一致，避免据此枚举账号
        raise BizError(E_PARAM, "系统未配置管理员联系电话，请联系管理员处理")
    return ok({"method": "phone", "contact_phone": phone, "message": "请致电管理员验证身份后重置密码"})


@router.post("/forgot/reset")
def forgot_reset(req: ResetReq, db: Session = Depends(get_db)) -> dict:
    with _lock:
        _cleanup_mem_state()
        rec = _reset_codes.get(req.username)
        if not rec or time.time() > rec[1]:
            raise BizError(E_PARAM, "重置码无效或已过期，请重新申请")
        if rec[0] != req.code.strip():
            n = _reset_fail.get(req.username, 0) + 1
            _reset_fail[req.username] = n
            if n >= 5:
                # 连续 5 次错误即作废重置码（防 6 位码爆破），需重新申请
                _reset_codes.pop(req.username, None)
                _reset_fail.pop(req.username, None)
                raise BizError(E_PARAM, "错误次数过多，重置码已作废，请重新申请")
            raise BizError(E_PARAM, "重置码错误")
    user = db.scalar(select(SysUser).where(SysUser.username == req.username))
    if user is None:
        raise BizError(E_PARAM, "账号不存在")
    user.password_hash = hash_password(req.new_password)
    with _lock:
        _reset_codes.pop(req.username, None)
        _reset_fail.pop(req.username, None)
    db.execute(SysSession.__table__.delete().where(SysSession.user_id == user.id))
    db.commit()
    session_delete_all(user.id)  # Redis 同步失效该用户全部会话
    return ok({"message": "密码已重置，请使用新密码登录"})


# ============================ 注册 ============================


@router.get("/register/status")
def register_status(db: Session = Depends(get_db)) -> dict:
    """注册模式与联系方式（前端控制注册入口展示）。"""
    mode = _cfg(db, "auth.register_mode", "closed")
    return ok({
        "mode": mode,
        "contact_phone": _cfg(db, "site.contact_phone"),
    })


@router.post("/register")
def register(req: RegisterReq, request: Request, db: Session = Depends(get_db)) -> dict:
    ip = request.client.host if request.client else "unknown"
    with _lock:
        _cleanup_mem_state()
        _drop_expired_ts(_register_quota, 3600)
        if len(_register_quota.get(ip, [])) >= 5:
            raise BizError(E_RATE_LIMITED, "注册过于频繁，请稍后再试")
        _register_quota.setdefault(ip, []).append(time.time())
        if len(_register_quota) > _MAX_REGISTER_KEYS:
            _drop_expired_ts(_register_quota, 3600)
            while len(_register_quota) > _MAX_REGISTER_KEYS:
                oldest = min(_register_quota, key=lambda k: (_register_quota[k][-1] if _register_quota[k] else 0))
                del _register_quota[oldest]
    mode = _cfg(db, "auth.register_mode", "closed")
    if mode not in ("open", "review"):
        raise BizError(E_PARAM, "系统未开放注册，请联系管理员开通账号")
    if db.scalar(select(SysUser.id).where(SysUser.username == req.username)):
        raise BizError(E_PARAM, "用户名已存在")
    if db.scalar(select(SysRegisterApply.id).where(
        SysRegisterApply.username == req.username, SysRegisterApply.status == 0
    )):
        raise BizError(E_PARAM, "该用户名已有待审核的注册申请")

    if mode == "open":
        role = db.scalar(select(SysRole).where(SysRole.code == REGISTER_ROLE_CODE))
        u = SysUser(
            username=req.username,
            password_hash=hash_password(req.password),
            real_name=req.real_name,
            phone=req.phone,
            email=req.email,
            role_id=role.id if role else 4,
            status=1,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        return ok({"status": "approved", "user_id": u.id, "message": "注册成功，请登录"})

    db.add(SysRegisterApply(
        username=req.username,
        password_hash=hash_password(req.password),
        real_name=req.real_name,
        phone=req.phone,
        email=req.email,
        status=0,
    ))
    db.commit()
    return ok({"status": "review", "message": "注册申请已提交，请等待管理员审核"})
