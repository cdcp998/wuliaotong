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
from app.core.deps import SUPER_ADMIN_ROLE_CODE, get_current_user
from app.core.response import BizError, E_CAPTCHA, E_LOGIN_FAILED, E_PARAM, ok
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

FAIL_LIMIT = 3  # 连续失败 3 次后要求验证码
FAIL_WINDOW = 600  # 失败计数窗口（秒）
CAPTCHA_TTL = 300
RESET_TTL = 900
_CAPTCHA_CHARS = string.digits + string.ascii_uppercase
_CAPTCHA_BLACKLIST = set("0O1lI")

REGISTER_ROLE_CODE = "user"  # 开放注册默认角色：使用者


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
    """返回用户权限点 code 列表；超级管理员返回全部。"""
    role = db.get(SysRole, user.role_id)
    if role and role.code == SUPER_ADMIN_ROLE_CODE:
        codes = db.scalars(
            select(SysPermission.code).order_by(SysPermission.id)
        ).all()
    else:
        codes = db.scalars(
            select(SysPermission.code)
            .join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
            .where(SysRolePermission.role_id == user.role_id)
            .order_by(SysPermission.id)
        ).all()
    return list(codes)


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

    token = generate_session_token()
    db.add(
        SysSession(
            session_id=token,
            user_id=user.id,
            expire_at=datetime.now() + timedelta(hours=settings.session_expire_hours),
        )
    )
    user.last_login_at = datetime.now()
    db.commit()

    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=int(settings.session_expire_hours * 3600),
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
    # 改密后使其他会话失效（保留当前会话）
    db.execute(
        SysSession.__table__.delete().where(SysSession.user_id == user.id)
    )
    db.commit()
    return ok()


# ============================ 找回密码 ============================


@router.post("/forgot")
def forgot(req: ForgotReq, db: Session = Depends(get_db)) -> dict:
    """按系统配置的找回方式处理：email 发重置码 / phone 返回管理员电话。"""
    method = _cfg(db, "auth.forgot_method", "phone")
    user = db.scalar(select(SysUser).where(SysUser.username == req.username))
    if user is None:
        raise BizError(E_PARAM, "账号不存在")
    if user.status != 1:
        raise BizError(E_PARAM, "账号已停用，请联系管理员")

    if method == "email":
        if not req.email or req.email.lower() != user.email.lower():
            raise BizError(E_PARAM, "邮箱与注册邮箱不一致")
        code = _gen_reset_code()
        with _lock:
            _reset_codes[req.username] = (code, time.time() + RESET_TTL)
        send_reset_code(db, user.email, req.username, code)
        return ok({"method": "email", "message": "重置验证码已发送至注册邮箱（15 分钟内有效）"})

    # phone / both 兜底：展示管理员联系电话（both 且用户填了邮箱也优先邮件？按 both 时优先 email，无邮箱则电话）
    if method == "both" and req.email and req.email.lower() == user.email.lower():
        code = _gen_reset_code()
        with _lock:
            _reset_codes[req.username] = (code, time.time() + RESET_TTL)
        send_reset_code(db, user.email, req.username, code)
        return ok({"method": "email", "message": "重置验证码已发送至注册邮箱（15 分钟内有效）"})

    phone = _cfg(db, "site.contact_phone")
    if not phone:
        raise BizError(E_PARAM, "系统未配置管理员联系电话，请联系管理员处理")
    return ok({"method": "phone", "contact_phone": phone, "message": "请致电管理员验证身份后重置密码"})


@router.post("/forgot/reset")
def forgot_reset(req: ResetReq, db: Session = Depends(get_db)) -> dict:
    with _lock:
        rec = _reset_codes.get(req.username)
    if not rec or time.time() > rec[1]:
        raise BizError(E_PARAM, "重置码无效或已过期，请重新申请")
    if rec[0] != req.code.strip():
        raise BizError(E_PARAM, "重置码错误")
    user = db.scalar(select(SysUser).where(SysUser.username == req.username))
    if user is None:
        raise BizError(E_PARAM, "账号不存在")
    user.password_hash = hash_password(req.new_password)
    with _lock:
        _reset_codes.pop(req.username, None)
    db.execute(SysSession.__table__.delete().where(SysSession.user_id == user.id))
    db.commit()
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
def register(req: RegisterReq, db: Session = Depends(get_db)) -> dict:
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
