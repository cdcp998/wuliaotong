"""邮件发送（SMTP，邮箱找回密码用）：配置存 sys_config（smtp.host/port/user/password/from）。"""
from __future__ import annotations

import smtplib
from email.mime.text import MIMEText
from email.header import Header

from sqlalchemy.orm import Session

from app.core.response import BizError, E_PARAM
from app.models.sys import SysConfig


def _cfg(db: Session, key: str, default: str = "") -> str:
    row = db.query(SysConfig).filter(SysConfig.config_key == key).first()
    return row.config_value if row and row.config_value else default


def send_mail(db: Session, to_addr: str, subject: str, content: str) -> None:
    """发送纯文本邮件；SMTP 未配置时抛 BizError(E_PARAM)。"""
    host = _cfg(db, "smtp.host")
    port = int(_cfg(db, "smtp.port", "465") or 465)
    user = _cfg(db, "smtp.user")
    password = _cfg(db, "smtp.password")
    sender = _cfg(db, "smtp.from") or user
    if not host or not user or not sender:
        raise BizError(E_PARAM, "系统未配置 SMTP（请联系管理员在系统设置中配置邮箱服务）")

    msg = MIMEText(content, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = sender
    msg["To"] = to_addr
    try:
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
            server.starttls()
        try:
            server.login(user, password)
            server.sendmail(sender, [to_addr], msg.as_string())
        finally:
            server.quit()
    except Exception as exc:  # 邮件失败不暴露内部细节
        raise BizError(E_PARAM, "邮件发送失败，请检查 SMTP 配置（详情见系统日志）")


def send_reset_code(db: Session, to_addr: str, username: str, code: str) -> None:
    """找回密码邮件：包含 15 分钟有效的 6 位重置码。"""
    site = _cfg(db, "site.name", "物料通管理系统")
    send_mail(
        db,
        to_addr,
        f"【{site}】密码重置验证码",
        f"您好：\n\n您在 {site} 申请重置账号「{username}」的密码。\n"
        f"重置验证码：{code}（15 分钟内有效，请勿泄露给他人）。\n\n"
        "如非本人操作，请忽略本邮件。",
    )
