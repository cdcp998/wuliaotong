-- =====================================================================
-- task 模块安装基线（线缆和设备插件方案 §4.3，4 张表 + 权限/菜单种子）
-- 约定：幂等（CREATE TABLE IF NOT EXISTS / INSERT ... WHERE NOT EXISTS）、禁止 DROP TABLE
-- 依赖：cable>=1.0.0,<2.0.0（模块级依赖，安装/启用在模块管理器校验）
-- =====================================================================

SET NAMES utf8mb4;

-- ---------- 维修任务 ----------
CREATE TABLE IF NOT EXISTS maintenance_task (
  id             BIGINT NOT NULL AUTO_INCREMENT,
  task_no        VARCHAR(30) NOT NULL COMMENT '任务单号（WX+日期+序号）',
  cable_id       BIGINT NULL COMMENT '→ cable.id',
  fault_id       BIGINT NULL COMMENT '→ cable_fault.id',
  title          VARCHAR(100) NOT NULL,
  description    VARCHAR(500) NOT NULL DEFAULT '',
  assignee_id    BIGINT NOT NULL DEFAULT 0 COMMENT '维修人员 → sys_user.id',
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                 COMMENT 'pending/assigned/in_progress/done/verified/closed/cancelled',
  priority       TINYINT NOT NULL DEFAULT 1 COMMENT '1 普通 / 2 紧急',
  scheduled_time DATETIME NULL COMMENT '计划时间',
  completed_at   DATETIME NULL COMMENT '完成时间（done）',
  verdict        VARCHAR(500) NOT NULL DEFAULT '' COMMENT '验收结论/驳回意见',
  cancel_reason  VARCHAR(500) NOT NULL DEFAULT '',
  cancelled_by   BIGINT NOT NULL DEFAULT 0,
  cancelled_at   DATETIME NULL,
  created_by     BIGINT NOT NULL DEFAULT 0,
  assigned_by    BIGINT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_task_no (task_no),
  KEY idx_status (status),
  KEY idx_assignee (assignee_id),
  KEY idx_fault (fault_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='维修任务';

-- ---------- 维修记录 ----------
CREATE TABLE IF NOT EXISTS task_record (
  id               BIGINT NOT NULL AUTO_INCREMENT,
  task_id          BIGINT NOT NULL COMMENT '→ maintenance_task.id',
  content          TEXT NULL COMMENT '维修内容',
  materials_used   TEXT NULL COMMENT '使用物料快照 JSON',
  knowledge_snapshot TEXT NULL COMMENT '知识快照 JSON',
  created_by       BIGINT NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务维修记录';

-- ---------- 维修记录照片 ----------
CREATE TABLE IF NOT EXISTS task_record_file (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  record_id  BIGINT NOT NULL COMMENT '→ task_record.id',
  file_id    BIGINT NOT NULL COMMENT '→ sys_file.id',
  category   VARCHAR(20) NOT NULL DEFAULT '维修后' COMMENT '维修前/维修中/维修后',
  sort_order INT NOT NULL DEFAULT 0,
  remark     VARCHAR(255) NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_record (record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务维修记录照片';

-- ---------- 任务-领用关联 ----------
CREATE TABLE IF NOT EXISTS task_requisition (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  task_type     VARCHAR(10) NOT NULL DEFAULT 'cable' COMMENT 'cable 线缆任务 / device 设备任务',
  task_id       BIGINT NOT NULL COMMENT '→ maintenance_task.id 或 device_task.id',
  requisition_id BIGINT NOT NULL COMMENT '→ out_requisition.id',
  created_by    BIGINT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_task_req (task_type, task_id, requisition_id),
  KEY idx_requisition (requisition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务-领用关联';

-- =====================================================================
-- 权限点种子（module_code='task'）
-- =====================================================================
INSERT IGNORE INTO sys_permission (name, code, type, sort, module_code) VALUES
  ('任务创建/派发/看板', 'task:dispatch', 2, 90, 'task'),
  ('任务处理',          'task:process',  2, 91, 'task'),
  ('任务验收/关闭',      'task:verify',   2, 92, 'task');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'dispatcher' AND p.code IN ('task:dispatch', 'task:verify')
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'repairer' AND p.code = 'task:process'
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

-- =====================================================================
-- 菜单种子（module_code='task'；模块停用时菜单自动隐藏）
-- =====================================================================
INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT 0, '维修任务', '', 'ToolOutlined', '', 1, 46, 'task'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE parent_id = 0 AND name = '维修任务' AND module_code = 'task');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '任务看板', '/task/board', 'ProjectOutlined', 'task:dispatch', 1, 10, 'task'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '维修任务' AND m.module_code = 'task'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/task/board');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '任务列表', '/task/list', 'UnorderedListOutlined', 'task:dispatch', 1, 20, 'task'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '维修任务' AND m.module_code = 'task'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/task/list');
