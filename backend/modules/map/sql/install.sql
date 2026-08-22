-- =====================================================================
-- map 模块安装基线（地图：图源配置/瓦片缓存区域；从 cable 模块拆分）
-- 约定：
--   1. 幂等：全部 CREATE TABLE IF NOT EXISTS / INSERT ... WHERE NOT EXISTS，可重复执行
--   2. 禁止 DROP TABLE（卸载不删表不删数据，数据红线）
--   3. 本文件作为 baseline（version='baseline'）纳入 sys_module_migration checksum
--   4. 依赖 cable 模块（地图工作台展示线缆/故障数据；权限 cable:view 由 cable 注册）
-- =====================================================================

SET NAMES utf8mb4;

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

-- ---------- 权限点归属迁移（拆分前 map:config/map:cache 挂在 cable；划转到 map） ----------
UPDATE sys_permission SET module_code = 'map'
WHERE code IN ('map:config', 'map:cache') AND module_code = 'cable';

-- 幂等补种（新库/已被清理时）
INSERT IGNORE INTO sys_permission (name, code, type, sort, module_code) VALUES
  ('地图源配置', 'map:config', 2, 84, 'map'),
  ('地图缓存管理', 'map:cache', 2, 85, 'map');

-- 角色授权（按角色 code 幂等授予；dispatcher 缓存管理）
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'dispatcher' AND p.code IN ('map:cache')
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

-- ---------- 菜单归属迁移（地图工作台/地图缓存管理 → map 模块顶级目录「地图」；路径不变，兼容已有菜单数据） ----------
UPDATE sys_menu SET module_code = 'map'
WHERE path IN ('/cable/map', '/cable/cache') AND module_code = 'cable';

-- 顶级目录「地图」（独立模块入口）
INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT 0, '地图', '', 'GlobalOutlined', '', 1, 46, 'map'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE parent_id = 0 AND name = '地图' AND module_code = 'map');

-- 已有地图菜单行移动到「地图」目录下（派生表避免 MySQL 同表 UPDATE 限制）
UPDATE sys_menu SET parent_id = (
  SELECT id FROM (SELECT id FROM sys_menu WHERE parent_id = 0 AND name = '地图' AND module_code = 'map') t
)
WHERE path IN ('/cable/map', '/cable/cache') AND module_code = 'map';

-- 补种（新库/清理后）
INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '地图工作台', '/cable/map', 'EnvironmentOutlined', 'cable:view', 1, 10, 'map'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '地图' AND m.module_code = 'map'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/cable/map');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '地图缓存管理', '/cable/cache', 'CloudDownloadOutlined', 'map:cache', 1, 20, 'map'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '地图' AND m.module_code = 'map'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/cable/cache');
