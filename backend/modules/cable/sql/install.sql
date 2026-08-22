-- =====================================================================
-- cable 模块安装基线（线缆和设备插件方案 §4.2，7 张表 + 权限/菜单种子）
-- 约定：
--   1. 幂等：全部 CREATE TABLE IF NOT EXISTS / INSERT ... WHERE NOT EXISTS，可重复执行
--   2. 禁止 DROP TABLE（卸载不删表不删数据，数据红线）
--   3. 本文件作为 baseline（version='baseline'）纳入 sys_module_migration checksum
-- =====================================================================

SET NAMES utf8mb4;

-- ---------- 线缆 ----------
CREATE TABLE IF NOT EXISTS cable (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  code          VARCHAR(50)  NOT NULL COMMENT '线缆编码',
  name          VARCHAR(100) NOT NULL COMMENT '线缆名称',
  type          VARCHAR(20)  NOT NULL DEFAULT 'wire' COMMENT 'wire 电线/fiber 光缆/network 网线',
  total_length  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '总长度（米，后端 geo_math 计算）',
  geometry      TEXT NULL COMMENT 'GeoJSON LineString（WGS84）',
  status        TINYINT NOT NULL DEFAULT 1 COMMENT '1 在用 / 0 停用 / 2 归档',
  description   VARCHAR(500) NOT NULL DEFAULT '',
  created_by    BIGINT NOT NULL DEFAULT 0,
  updated_by    BIGINT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线缆';

-- ---------- 线缆路径节点（累计距离索引表） ----------
CREATE TABLE IF NOT EXISTS cable_point (
  id                  BIGINT NOT NULL AUTO_INCREMENT,
  cable_id            BIGINT NOT NULL COMMENT '→ cable.id',
  seq                 INT    NOT NULL DEFAULT 1,
  lat                 DECIMAL(10,7) NOT NULL,
  lng                 DECIMAL(10,7) NOT NULL,
  cumulative_distance DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '累计距离（米）',
  label               VARCHAR(100) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uk_cable_seq (cable_id, seq),
  KEY idx_cable (cable_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线缆路径节点（累计距离索引表）';

-- ---------- 标记点 ----------
CREATE TABLE IF NOT EXISTS cable_marker (
  id                  BIGINT NOT NULL AUTO_INCREMENT,
  cable_id            BIGINT NOT NULL COMMENT '→ cable.id',
  lat                 DECIMAL(10,7) NOT NULL,
  lng                 DECIMAL(10,7) NOT NULL,
  cumulative_distance DECIMAL(12,2) NOT NULL DEFAULT 0,
  marker_type         VARCHAR(30) NOT NULL DEFAULT '' COMMENT '接头/转角/其他',
  label               VARCHAR(100) NOT NULL DEFAULT '',
  remark              VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_cable (cable_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线缆标记点';

-- ---------- 故障点 ----------
CREATE TABLE IF NOT EXISTS cable_fault (
  id                  BIGINT NOT NULL AUTO_INCREMENT,
  cable_id            BIGINT NULL COMMENT '→ cable.id（可空=暂未关联线缆）',
  lat                 DECIMAL(10,7) NOT NULL,
  lng                 DECIMAL(10,7) NOT NULL,
  cumulative_distance DECIMAL(12,2) NOT NULL DEFAULT 0,
  fault_type          VARCHAR(30) NOT NULL DEFAULT '',
  severity            TINYINT NOT NULL DEFAULT 1 COMMENT '1 低 / 2 中 / 3 高',
  description         VARCHAR(500) NOT NULL DEFAULT '',
  status              TINYINT NOT NULL DEFAULT 0 COMMENT '0 待处理 / 1 处理中 / 2 待验证 / 3 已修复 / 4 已关闭',
  reported_by         BIGINT NOT NULL DEFAULT 0 COMMENT '上报人 → sys_user.id',
  reported_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  photos_note         VARCHAR(255) NOT NULL DEFAULT '',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cable (cable_id),
  KEY idx_status (status),
  KEY idx_reported (reported_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='故障点';

-- ---------- 故障照片关联 ----------
CREATE TABLE IF NOT EXISTS fault_file (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  fault_id   BIGINT NOT NULL COMMENT '→ cable_fault.id',
  file_id    BIGINT NOT NULL COMMENT '→ sys_file.id',
  category   VARCHAR(20) NOT NULL DEFAULT '现场' COMMENT '故障位置/现场/维修后',
  sort_order INT    NOT NULL DEFAULT 0,
  remark     VARCHAR(255) NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fault (fault_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='故障照片关联';

-- ---------- 地图缓存区域 ----------
CREATE TABLE IF NOT EXISTS map_cache_region (
  id               BIGINT NOT NULL AUTO_INCREMENT,
  name             VARCHAR(100) NOT NULL,
  geometry         TEXT NULL COMMENT 'GeoJSON（含 bbox）',
  min_zoom         INT NOT NULL DEFAULT 0,
  max_zoom         INT NOT NULL DEFAULT 18,
  tile_count       INT NOT NULL DEFAULT 0,
  cache_size       BIGINT NOT NULL DEFAULT 0 COMMENT '缓存占用字节',
  last_download_at DATETIME NULL,
  update_mode      VARCHAR(10) NOT NULL DEFAULT 'manual' COMMENT 'daily/weekly/manual',
  status           TINYINT NOT NULL DEFAULT 0 COMMENT '0 未开始 / 1 下载中 / 2 完成 / 3 暂停',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='地图缓存区域（批量下载）';

-- ---------- 瓦片下载任务 ----------
CREATE TABLE IF NOT EXISTS map_download_task (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  region_id   BIGINT NOT NULL COMMENT '→ map_cache_region.id',
  z           INT NOT NULL,
  x           INT NOT NULL,
  y           INT NOT NULL,
  status      TINYINT NOT NULL DEFAULT 0 COMMENT '0 待下载 / 1 成功 / 2 失败 / 3 跳过',
  retry_count INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_region_xyz (region_id, z, x, y)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='瓦片下载任务';

-- =====================================================================
-- 权限点种子（module_code='cable'；禁用模块时权限点不生效，见 §8.1）
-- =====================================================================
INSERT IGNORE INTO sys_permission (name, code, type, sort, module_code) VALUES
  ('线缆/地图查看', 'cable:view',   2, 80, 'cable'),
  ('线缆管理',     'cable:manage', 2, 81, 'cable'),
  ('故障上报',     'fault:report', 2, 82, 'cable'),
  ('故障管理',     'fault:manage', 2, 83, 'cable'),
  ('地图源配置',   'map:config',   2, 84, 'cable'),
  ('地图缓存管理', 'map:cache',    2, 85, 'cable');

-- 角色授权（按角色 code 幂等授予）
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'dispatcher' AND p.code IN ('cable:view','cable:manage','fault:manage','map:cache')
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'repairer' AND p.code IN ('cable:view','fault:report')
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

-- =====================================================================
-- 菜单种子（module_code='cable'；模块停用时菜单自动隐藏）
-- =====================================================================
INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT 0, '线缆管理', '', 'DeploymentUnitOutlined', '', 1, 45, 'cable'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE parent_id = 0 AND name = '线缆管理' AND module_code = 'cable');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '地图工作台', '/cable/map', 'EnvironmentOutlined', 'cable:view', 1, 10, 'cable'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '线缆管理' AND m.module_code = 'cable'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/cable/map');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '线缆管理', '/cable/list', 'DeploymentUnitOutlined', 'cable:manage', 1, 20, 'cable'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '线缆管理' AND m.module_code = 'cable'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/cable/list');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '故障管理', '/cable/faults', 'AlertOutlined', 'fault:manage', 1, 30, 'cable'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '线缆管理' AND m.module_code = 'cable'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/cable/faults');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '地图缓存管理', '/cable/cache', 'CloudDownloadOutlined', 'map:cache', 1, 40, 'cable'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '线缆管理' AND m.module_code = 'cable'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/cable/cache');
