"""核心库升级（存量库 → 模块插件机制）：幂等增补，不重建表不丢数据。

适用：已按旧版 init.sql 初始化的数据库（升级到线缆和设备插件方案核心变更）：
- sys_module / sys_module_migration / sys_notification_delivery（新表）
- sys_permission.module_code / sys_menu.module_code / sys_notification.channels（新列）
- 种子：角色 dispatcher/repairer、权限 module:manage、菜单「安装模块」、sms.* 配置

用法：python scripts/migrate_module_plugin.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.core.migration_utils import column_exists, execute_sql_script, table_exists  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("migrate_module_plugin")

# 与 sql/init.sql 保持一致的新结构 DDL（仅新表/新列，不做任何 DROP）
_DDL = """
CREATE TABLE IF NOT EXISTS sys_module (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(50)  NOT NULL COMMENT '模块编码，如 cable',
  name        VARCHAR(100) NOT NULL COMMENT '模块名称',
  version     VARCHAR(20)  NOT NULL DEFAULT '1.0.0' COMMENT '插件版版本号（SemVer）',
  state       VARCHAR(20)  NOT NULL DEFAULT 'NOT_INSTALLED'
              COMMENT 'NOT_INSTALLED/INSTALLING/INSTALLED/ENABLED/DISABLED/ERROR/UPGRADING',
  schema_version VARCHAR(20) NOT NULL DEFAULT '0' COMMENT '已执行的模块 SQL 结构版本（migration 序号）',
  depends     JSON         NULL COMMENT '依赖约束（JSON 数组，如 ["cable>=1.2.0,<2.0.0"]；SemVer 校验）',
  config      JSON         NULL COMMENT '模块配置（JSON，敏感字段脱敏）',
  description VARCHAR(255) NOT NULL DEFAULT '',
  last_error  VARCHAR(500) NOT NULL DEFAULT '' COMMENT '最近异常信息（ERROR 态）',
  last_error_at DATETIME   NULL COMMENT '最近异常时间',
  installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='功能模块注册表';

CREATE TABLE IF NOT EXISTS sys_module_migration (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  module_code VARCHAR(50)  NOT NULL COMMENT '→ sys_module.code',
  version     VARCHAR(50)  NOT NULL COMMENT 'migration 标识（如 0001_initial / baseline）',
  checksum    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT 'migration 文件 sha256',
  success     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 成功 / 0 失败',
  executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_module_version (module_code, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块 migration 执行记录';

CREATE TABLE IF NOT EXISTS sys_notification_delivery (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  notification_id BIGINT   NULL COMMENT '→ sys_notification.id（逻辑引用）',
  biz_type    VARCHAR(30)  NOT NULL DEFAULT '' COMMENT '业务类型冗余（通知被删后仍可定位业务对象）',
  biz_id      BIGINT       NOT NULL DEFAULT 0 COMMENT '业务 id 冗余（审计对账）',
  channel     VARCHAR(10)  NOT NULL COMMENT 'internal/email/sms',
  recipient   VARCHAR(100) NOT NULL DEFAULT '' COMMENT '接收方（user_id/邮箱/手机号）',
  status      VARCHAR(10)  NOT NULL DEFAULT 'pending' COMMENT 'pending/sending/success/failed/cancelled',
  provider    VARCHAR(20)  NOT NULL DEFAULT '' COMMENT '短信/邮件服务商',
  provider_message_id VARCHAR(100) NOT NULL DEFAULT '' COMMENT '服务商回执 id',
  idempotency_key VARCHAR(64) NOT NULL DEFAULT '' COMMENT '幂等键（防重复发送）',
  retry_count INT          NOT NULL DEFAULT 0,
  last_error  VARCHAR(500) NOT NULL DEFAULT '',
  sent_at     DATETIME     NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notification (notification_id),
  KEY idx_biz (biz_type, biz_id),
  KEY idx_status (status),
  UNIQUE KEY uk_idempotency (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知投递记录（三渠道实际触达与状态）';
"""

_SEEDS = """
INSERT IGNORE INTO sys_role (id, code, name, description, is_builtin) VALUES
  (5, 'dispatcher', '调度员', '线缆/故障/地图缓存/任务派发验收/设备管理/知识（模块权限随模块安装授予）', 1),
  (6, 'repairer', '维修人员', '领用申请、库存查询、线缆查看、故障上报、任务处理、设备任务、知识查看（合并原使用者+巡检）', 1);

INSERT IGNORE INTO sys_permission (id, name, code, type, sort, module_code) VALUES
  (27, '安装模块', 'module:manage', 2, 77, '');

INSERT IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (6, 13), (6, 8);

INSERT INTO sys_menu (id, parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT 36, 26, '安装模块', '/system/modules', 'AppstoreAddOutlined', 'module:manage', 1, 25, ''
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id = 36);

INSERT IGNORE INTO sys_config (config_key, config_value, remark) VALUES
  ('sms.provider', '', '短信服务商：aliyun/tencent/ronglian/http（线缆和设备插件方案 §4.6）'),
  ('sms.key', '', '短信 AccessKey（secret，接口脱敏）'),
  ('sms.secret', '', '短信 AccessKey Secret（secret，接口脱敏）'),
  ('sms.sign', '', '短信签名'),
  ('sms.endpoint', '', '短信接口地址（通用 HTTP 服务商）');
"""


def main() -> int:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    db = SessionLocal()
    try:
        execute_sql_script(_DDL)
        logger.info("新表就绪：sys_module / sys_module_migration / sys_notification_delivery")
        if not column_exists(db, "sys_permission", "module_code"):
            db.execute(text("ALTER TABLE sys_permission ADD COLUMN module_code VARCHAR(50) NOT NULL DEFAULT '' COMMENT '归属模块编码（空=核心权限）'"))
            logger.info("sys_permission.module_code 已加")
        if not column_exists(db, "sys_menu", "module_code"):
            db.execute(text("ALTER TABLE sys_menu ADD COLUMN module_code VARCHAR(50) NOT NULL DEFAULT '' COMMENT '归属模块编码（空=核心菜单）'"))
            logger.info("sys_menu.module_code 已加")
        if not column_exists(db, "sys_notification", "channels"):
            db.execute(text("ALTER TABLE sys_notification ADD COLUMN channels VARCHAR(50) NOT NULL DEFAULT 'internal' COMMENT '投递渠道（逗号分隔）：internal/email/sms'"))
            logger.info("sys_notification.channels 已加")
        db.commit()
        execute_sql_script(_SEEDS)
        logger.info("种子就绪：调度员/维修人员角色、module:manage 权限、安装模块菜单、sms.* 配置")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("升级失败：%s", exc)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
