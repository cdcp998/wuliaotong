-- =====================================================================
-- knowledge 模块安装基线（线缆和设备插件方案 §4.4，4 张表 + 权限/菜单种子）
-- 约定：幂等（CREATE TABLE IF NOT EXISTS / INSERT ... WHERE NOT EXISTS）、禁止 DROP TABLE
-- =====================================================================

SET NAMES utf8mb4;

-- ---------- 知识条目 ----------
CREATE TABLE IF NOT EXISTS knowledge_article (
  id              BIGINT NOT NULL AUTO_INCREMENT,
  title           VARCHAR(200) NOT NULL,
  content         LONGTEXT NOT NULL COMMENT '正文（Markdown）',
  version         INT NOT NULL DEFAULT 1 COMMENT '当前版本号（编辑自增）',
  published_version INT NOT NULL DEFAULT 0 COMMENT '已发布版本号（发布时=version 快照）',
  category        VARCHAR(50) NOT NULL DEFAULT '' COMMENT '分类（如 光缆/熔接/终端）',
  tags            TEXT NULL COMMENT '标签 JSON 数组',
  related_cable_types TEXT NULL COMMENT '相关线缆类型 JSON 数组（wire/fiber/network）',
  related_fault_types TEXT NULL COMMENT '相关故障类型 JSON 数组',
  author_type     VARCHAR(10) NOT NULL DEFAULT 'manual' COMMENT 'ai / manual',
  status          TINYINT NOT NULL DEFAULT 0 COMMENT '0 草稿 / 1 已发布 / 2 已归档',
  source_task_id  BIGINT NOT NULL DEFAULT 0 COMMENT '来源任务（AI 生成）',
  created_by      BIGINT NOT NULL DEFAULT 0,
  published_by    BIGINT NOT NULL DEFAULT 0,
  published_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status (status),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识条目';

-- ---------- 版本快照 ----------
CREATE TABLE IF NOT EXISTS knowledge_article_revision (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  article_id BIGINT NOT NULL COMMENT '→ knowledge_article.id',
  version    INT NOT NULL,
  title      VARCHAR(200) NOT NULL,
  content    LONGTEXT NOT NULL,
  status     TINYINT NOT NULL DEFAULT 1 COMMENT '1 已发布快照 / 2 归档快照',
  created_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_article_version (article_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识条目版本快照';

-- ---------- 知识-物料关联 ----------
CREATE TABLE IF NOT EXISTS knowledge_material_link (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  article_id BIGINT NOT NULL COMMENT '→ knowledge_article.id',
  product_id BIGINT NOT NULL COMMENT '→ base_product.id',
  note       VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_article_product (article_id, product_id),
  KEY idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识-物料关联';

-- ---------- AI 生成任务 ----------
CREATE TABLE IF NOT EXISTS knowledge_generate_task (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  status      VARCHAR(10) NOT NULL DEFAULT 'queued' COMMENT 'queued/running/success/failed',
  input       TEXT NOT NULL COMMENT '生成入参 JSON（title/topic/context）',
  article_id  BIGINT NOT NULL DEFAULT 0 COMMENT '生成成功后的草稿 id',
  model       VARCHAR(50) NOT NULL DEFAULT '' COMMENT '实际使用的模型',
  last_error  VARCHAR(500) NOT NULL DEFAULT '',
  retry_count INT NOT NULL DEFAULT 0 COMMENT '重试次数（≤2）',
  created_by  BIGINT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识 AI 生成任务';

-- =====================================================================
-- 权限点种子（module_code='knowledge'）
-- =====================================================================
INSERT IGNORE INTO sys_permission (name, code, type, sort, module_code) VALUES
  ('知识查看',   'knowledge:view',   2, 95, 'knowledge'),
  ('知识编写/AI生成', 'knowledge:write', 2, 96, 'knowledge'),
  ('知识审核发布', 'knowledge:review', 2, 97, 'knowledge');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'dispatcher' AND p.code IN ('knowledge:view', 'knowledge:write', 'knowledge:review')
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'repairer' AND p.code = 'knowledge:view'
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.code = 'storekeeper' AND p.code = 'knowledge:write'
  AND NOT EXISTS (SELECT 1 FROM sys_role_permission srp WHERE srp.role_id = r.id AND srp.permission_id = p.id);

-- =====================================================================
-- 菜单种子（module_code='knowledge'）
-- =====================================================================
INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT 0, '知识库', '', 'ReadOutlined', '', 1, 47, 'knowledge'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE parent_id = 0 AND name = '知识库' AND module_code = 'knowledge');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '知识库', '/knowledge', 'ReadOutlined', 'knowledge:view', 1, 10, 'knowledge'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '知识库' AND m.module_code = 'knowledge'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/knowledge');

INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code)
SELECT m.id, '知识库管理', '/knowledge/write', 'EditOutlined', 'knowledge:write', 1, 20, 'knowledge'
FROM sys_menu m
WHERE m.parent_id = 0 AND m.name = '知识库' AND m.module_code = 'knowledge'
  AND NOT EXISTS (SELECT 1 FROM sys_menu s WHERE s.parent_id = m.id AND s.path = '/knowledge/write');
