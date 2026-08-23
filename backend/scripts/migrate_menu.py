"""开发库迁移：sys_menu 导航菜单表 + 种子（幂等，INSERT IGNORE 保留管理员已改配置）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402

DDL = """
CREATE TABLE IF NOT EXISTS sys_menu (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  parent_id   BIGINT       NOT NULL DEFAULT 0 COMMENT '父级（0=顶级分组）',
  name        VARCHAR(50)  NOT NULL COMMENT '菜单名称',
  path        VARCHAR(100) NOT NULL DEFAULT '' COMMENT '路由路径（菜单项）；分组留空',
  icon        VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '图标名（前端 ICON_MAP 注册）',
  perm_code   VARCHAR(100) NOT NULL DEFAULT '' COMMENT '权限码；逗号分隔=任一命中可见；空=公开',
  visible     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 显示 / 0 隐藏',
  sort        INT          NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
  remark      VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='导航菜单（动态菜单管理）'
"""

SEED = [
    (1, 0, "工作台", "", "DashboardOutlined", "", 1, 10),
    (2, 1, "经营看板", "/dashboard", "DashboardOutlined", "report:view", 1, 10),
    (3, 0, "基础资料", "", "ShopOutlined", "", 1, 20),
    (4, 3, "物料数据管理", "/materials-data", "AppstoreOutlined", "base:product,base:category", 1, 10),
    (5, 3, "删除审核", "/delete-reviews", "AuditOutlined", "base:product,base:category", 1, 20),
    (6, 3, "供应商管理", "/suppliers", "ContactsOutlined", "base:supplier", 1, 30),
    (7, 3, "材料单位管理", "/units", "NumberOutlined", "base:product", 1, 40),
    (8, 0, "入库管理", "", "InboxOutlined", "", 1, 30),
    (9, 8, "采购计划单", "/purchase-plans", "FileTextOutlined", "pch:in", 1, 10),
    (10, 8, "材料入库", "/purchase-in", "InboxOutlined", "pch:in", 1, 20),
    (11, 8, "送货单识别入库", "/ocr/delivery", "FileSearchOutlined", "pch:ocr", 1, 30),
    (12, 0, "库存管理", "", "DatabaseOutlined", "", 1, 40),
    (13, 12, "库存查询", "/stock", "TableOutlined", "stk:query", 1, 10),
    (14, 12, "仓库与货架", "/warehouses", "BankOutlined", "base:warehouse", 1, 20),
    (15, 12, "历史价格管理", "/history-price", "LineChartOutlined", "stk:query", 1, 30),
    (16, 12, "库存调拨", "/transfers", "SwapOutlined", "stk:transfer", 1, 40),
    (17, 12, "其他出入库", "/other-io", "ExportOutlined", "stk:other", 1, 50),
    (18, 0, "领用管理", "", "EditOutlined", "", 1, 50),
    (19, 18, "领用申请", "/requisitions/apply", "EditOutlined", "req:apply", 1, 10),
    (20, 18, "领用申请单查询", "/requisitions/query", "SearchOutlined", "req:audit", 1, 20),
    (21, 18, "领用审计", "/requisitions", "AuditOutlined", "req:audit", 1, 30),
    (22, 0, "报表中心", "", "FundOutlined", "", 1, 60),
    (23, 22, "报表中心", "/reports", "FundOutlined", "report:view", 1, 10),
    (24, 22, "盘点", "/checks", "ProfileOutlined", "stk:check", 1, 20),
    (25, 22, "AI 建议处理", "/ai-suggestions", "RobotOutlined", "ai:suggestion", 1, 30),
    (26, 0, "系统管理", "", "SettingOutlined", "", 1, 70),
    (27, 26, "用户管理", "/system/users", "UserOutlined", "sys:user", 1, 10),
    (28, 26, "用户权限设置", "/system/roles", "SafetyCertificateOutlined", "sys:role", 1, 20),
    (29, 26, "注册审核", "/system/register-applies", "AuditOutlined", "sys:user", 1, 30),
    (30, 3, "单位管理", "/system/departments", "ApartmentOutlined", "dept:manage", 1, 50),
    (31, 26, "导航管理", "/system/menus", "MenuOutlined", "sys:role", 1, 45),
    (32, 26, "操作日志", "/system/logs", "FileTextOutlined", "sys:log", 1, 50),
    (33, 26, "备份管理", "/system/backups", "HddOutlined", "sys:backup", 1, 60),
    (34, 26, "AI 调用日志", "/llm-logs", "RobotOutlined", "sys:llm-log", 1, 70),
    (35, 26, "系统设置", "/system/settings", "SettingOutlined", "sys:config", 1, 80),
]

with engine.begin() as conn:
    conn.execute(text(DDL))
    for row in SEED:
        conn.execute(
            text("INSERT IGNORE INTO sys_menu (id, parent_id, name, path, icon, perm_code, visible, sort) "
                 "VALUES (:id, :p, :name, :path, :icon, :perm, :vis, :sort)"),
            {"id": row[0], "p": row[1], "name": row[2], "path": row[3], "icon": row[4], "perm": row[5], "vis": row[6], "sort": row[7]},
        )
print("sys_menu table + seed ready:", len(SEED))
