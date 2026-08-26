-- =====================================================================
-- device 模块安装基线（线缆和设备插件方案 §4.5，4 张表 + 权限/菜单种子）
-- SQL 版本：v1（未发布阶段，结构变更直接并入本基线）
-- 约定：幂等（CREATE TABLE IF NOT EXISTS / INSERT ... WHERE NOT EXISTS）、禁止 DROP TABLE
-- 生命周期：1 在用 / 2 维修中 / 3 闲置 / 4 报废；维修中禁止报废
-- =====================================================================

SET NAMES utf8mb4;

-- ---------- 设备台账 ----------
CREATE TABLE IF NOT EXISTS device (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  code          VARCHAR(50) NOT NULL COMMENT '设备编码',
  name          VARCHAR(100) NOT NULL COMMENT '设备名称',
  model         VARCHAR(100) NOT NULL DEFAULT '' COMMENT '型号/规格',
  category      VARCHAR(50) NOT NULL DEFAULT '' COMMENT '类别',
  department_id BIGINT NOT NULL DEFAULT 0 COMMENT '所属单位 → base_department.id',
  location      VARCHAR(200) NOT NULL DEFAULT '' COMMENT '物理位置描述',
  lat           DECIMAL(10,7) NULL COMMENT 'WGS84 纬度',
  lng           DECIMAL(10,7) NULL COMMENT 'WGS84 经度',
  status        TINYINT NOT NULL DEFAULT 1 COMMENT '1 在用 / 2 维修中 / 3 闲置 / 4 报废',
  purchase_date DATE NULL,
  warranty_end  DATE NULL,
  remark        VARCHAR(500) NOT NULL DEFAULT '',
  created_by    BIGINT NOT NULL DEFAULT 0,
  updated_by    BIGINT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='设备台账';

-- ---------- 设备维修任务 ----------
CREATE TABLE IF NOT EXISTS device_task (
  id              BIGINT NOT NULL AUTO_INCREMENT,
  task_no         VARCHAR(30) NOT NULL COMMENT '任务单号（WX-SB+日期+序号）',
  device_id       BIGINT NOT NULL COMMENT '→ device.id',
  title           VARCHAR(100) NOT NULL,
  description     VARCHAR(500) NOT NULL DEFAULT '',
  assignee_id     BIGINT NOT NULL DEFAULT 0 COMMENT '维修人员 → sys_user.id',
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  COMMENT 'pending/assigned/in_progress/done/verified/closed/cancelled',
  dispatch_mode   VARCHAR(10) NOT NULL DEFAULT 'manual' COMMENT '派发方式: manual手动/open公开任务单/hybrid公开+可派发',
  priority        TINYINT NOT NULL DEFAULT 1 COMMENT '1 普通 / 2 紧急',
  scheduled_time  DATETIME NULL,
  completed_at    DATETIME NULL,
  created_by      BIGINT NOT NULL DEFAULT 0,
  assigned_by     BIGINT NOT NULL DEFAULT 0,
  verdict         VARCHAR(500) NOT NULL DEFAULT '',
  previous_status TINYINT NOT NULL DEFAULT 0 COMMENT '创建设备维修任务时设备状态快照（完成/取消按此回退，方案 v2.1）',
  cancel_reason   VARCHAR(500) NOT NULL DEFAULT '',
  cancelled_by    BIGINT NOT NULL DEFAULT 0,
  cancelled_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_task_no (task_no),
  KEY idx_device (device_id),
  KEY idx_status (status),
  KEY idx_assignee (assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='设备维修任务';

-- ---------- 设备维修记录 ----------
CREATE TABLE IF NOT EXISTS device_task_record (
  id               BIGINT NOT NULL AUTO_INCREMENT,
  task_id          BIGINT NOT NULL COMMENT '→ device_task.id',
  content          TEXT NULL,
  materials_used   TEXT NULL COMMENT '使用物料快照 JSON',
  knowledge_snapshot TEXT NULL,
  created_by       BIGINT NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='设备维修记录';

CREATE TABLE IF NOT EXISTS device_task_record_file (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  record_id  BIGINT NOT NULL COMMENT '→ device_task_record.id',
  file_id    BIGINT NOT NULL COMMENT '→ sys_file.id',
  category   VARCHAR(20) NOT NULL DEFAULT '维修后',
  sort_order INT NOT NULL DEFAULT 0,
  remark     VARCHAR(255) NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_record (record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='设备维修记录照片';

-- ---------- 设备图片 ----------
CREATE TABLE IF NOT EXISTS device_file (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  device_id  BIGINT NOT NULL COMMENT '→ device.id',
  file_id    BIGINT NOT NULL COMMENT '→ sys_file.id',
  sort_order INT NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='设备图片';

-- =====================================================================
-- 权限点种子（module_code='device'）
-- =====================================================================
INSERT IGNORE INTO sys_permission (name, code, type, sort, module_code) VALUES
  ('设备台账管理', 'device:manage', 2, 100, 'device'),
  ('设备故障管理', 'device:task',   2, 101, 'device');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'dispatcher' AND p.code IN ('device:manage', 'device:task')
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'repairer' AND p.code = 'device:task'
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

-- =====================================================================
-- 菜单种子（module_code='device'）
-- =====================================================================
INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT 0, '设备管理', '', 'DesktopOutlined', '', 1, 48, 'device'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE parent_id = 0 AND name = '设备管理' AND module_code = 'device');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '设备台账', '/device/list', 'DesktopOutlined', 'device:manage', 1, 10, 'device'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '设备管理' AND m.module_code = 'device'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/device/list');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '设备故障管理', '/device/tasks', 'ToolOutlined', 'device:task', 1, 20, 'device'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '设备管理' AND m.module_code = 'device'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/device/tasks');
