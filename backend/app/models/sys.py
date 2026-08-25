"""系统/认证相关 ORM 模型（对应《数据库设计.md》§2.1-2.2，10 张表）。

注意：表结构以 backend/sql/init.sql 为唯一事实来源，模型仅做映射。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class SysUser(TimestampMixin, Base):
    __tablename__ = "sys_user"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    real_name: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(100), nullable=False, default="")  # 找回密码用
    role_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    department_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # 所属单位 → base_department.id
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1启用 0停用
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SysRegisterApply(Base):
    """注册申请（审核注册模式）：管理员通过后创建 SysUser。"""

    __tablename__ = "sys_register_apply"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    real_name: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0 待审核 / 1 通过 / 2 拒绝
    handled_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class SysDeleteReview(Base):
    """删除审核（物料数据删除审批流）：仓管员及以上提交删除申请，管理者及以上角色审核后执行删除。

    biz_type：product（停用材料）/ category（删除分类）；status：0 待审核 / 1 已通过（已删除） / 2 已驳回。
    """

    __tablename__ = "sys_delete_review"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    biz_type: Mapped[str] = mapped_column(String(20), nullable=False, default="product")
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    target_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    target_desc: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0 待审核 / 1 已通过 / 2 已驳回
    applicant_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    applicant_name: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    handled_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_remark: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class SysMenu(TimestampMixin, Base):
    """导航菜单（动态导航管理）：多级菜单树，按角色权限动态渲染侧边导航。

    - parent_id：0=顶级分组；支持多级（分组→菜单，可再嵌套）
    - path：路由路径（菜单项）；分组留空
    - perm_code：绑定权限码（逗号分隔=任一命中即可见；空=公开菜单）
    - visible：1 显示 / 0 隐藏（管理员手动隐藏，即使有权限也不显示）
    """

    __tablename__ = "sys_menu"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    path: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    icon: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    perm_code: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    visible: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    module_code: Mapped[str] = mapped_column(String(50), nullable=False, default="")  # 归属模块（空=核心菜单）；模块未启用时菜单不可见
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class SysRole(TimestampMixin, Base):
    __tablename__ = "sys_role"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    is_builtin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 内置角色禁删
    department_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # 所属单位（控制可见货架）


class SysPermission(TimestampMixin, Base):
    __tablename__ = "sys_permission"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    type: Mapped[int] = mapped_column(Integer, nullable=False, default=2)  # 1菜单 2按钮
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    module_code: Mapped[str] = mapped_column(String(50), nullable=False, default="")  # 归属模块（空=核心权限）；模块停用时权限点不生效


class SysRolePermission(Base):
    __tablename__ = "sys_role_permission"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    role_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    permission_id: Mapped[int] = mapped_column(BigInteger, nullable=False)


class SysSession(Base):
    __tablename__ = "sys_session"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    ip: Mapped[str] = mapped_column(String(45), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    expire_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class SysConfig(Base):
    __tablename__ = "sys_config"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    config_key: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    config_value: Mapped[str] = mapped_column(Text, nullable=False)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class LlmLog(Base):
    """大模型调用日志（P9）：所有 LLM 调用的输入/输出/耗时/成败，供后期调整与学习。"""

    __tablename__ = "sys_llm_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    scene: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    prompt: Mapped[str] = mapped_column(Text, nullable=False)  # 输入（图片仅记张数）
    output: Mapped[str] = mapped_column(Text, nullable=False)  # 输出（截断保存）
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ok")
    error: Mapped[str] = mapped_column(Text, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class SysOperationLog(Base):
    __tablename__ = "sys_operation_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    module: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    action: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    method: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    url: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    params: Mapped[str] = mapped_column(Text, nullable=False)  # JSON 字符串（query 参数）
    body: Mapped[str | None] = mapped_column(Text, nullable=True)  # 请求体 JSON（脱敏后；「具体改了什么」）
    ip: Mapped[str] = mapped_column(String(45), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # HTTP 状态码（详情展示）
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class SysNotification(TimestampMixin, Base):
    __tablename__ = "sys_notification"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    biz_type: Mapped[str] = mapped_column(String(30), nullable=False, default="")  # 预警/待办/审批
    link: Mapped[str] = mapped_column(String(255), nullable=False, default="")  # 业务联动跳转目标（移动端路由），兼作业务去重/自动已读的唯一键
    channels: Mapped[str] = mapped_column(String(50), nullable=False, default="internal")  # 投递渠道（逗号分隔）：internal/email/sms
    is_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SysModule(Base):
    """功能模块注册表（线缆和设备插件方案 §2.2）。

    state：NOT_INSTALLED/INSTALLING/INSTALLED/ENABLED/DISABLED/ERROR/UPGRADING；
    schema_version：已执行的模块 SQL 结构版本（migration 序号，baseline=0 起点）。
    """

    __tablename__ = "sys_module"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[str] = mapped_column(String(20), nullable=False, default="1.0.0")
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="NOT_INSTALLED")
    schema_version: Mapped[str] = mapped_column(String(20), nullable=False, default="0")
    depends: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON 数组
    config: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    last_error: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    installed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class SysModuleMigration(Base):
    """模块 migration 执行记录（checksum 拦截漂移/重复执行）。"""

    __tablename__ = "sys_module_migration"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    module_code: Mapped[str] = mapped_column(String(50), nullable=False)
    version: Mapped[str] = mapped_column(String(50), nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    success: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    executed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class SysNotificationDelivery(Base):
    """通知投递记录（三渠道实际触达与状态，线缆和设备插件方案 §4.1）。

    biz_type/biz_id 为业务键冗余：通知被用户删除后投递记录仍可定位业务对象（审计对账）。
    """

    __tablename__ = "sys_notification_delivery"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    notification_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    biz_type: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    biz_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    channel: Mapped[str] = mapped_column(String(10), nullable=False)  # internal/email/sms
    recipient: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    provider_message_id: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class SysBackupLog(Base):
    __tablename__ = "sys_backup_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    file_path: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    backup_type: Mapped[str] = mapped_column(String(10), nullable=False, default="auto")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class SysFile(TimestampMixin, Base):
    __tablename__ = "sys_file"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    biz_type: Mapped[str] = mapped_column(String(30), nullable=False)  # purchase_bill/requisition_item/...
    biz_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    storage_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # → sys_storage.id
    original_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    file_path: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    md5: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    uploader_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class SysStorage(TimestampMixin, Base):
    """存储位置（多存储地址，后台管理）。"""

    __tablename__ = "sys_storage"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="local")
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    policy: Mapped[str] = mapped_column(String(10), nullable=False, default="fill")  # fill/round/manual
    is_default: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
