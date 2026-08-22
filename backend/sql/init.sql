-- =====================================================================
-- 物料通管理系统 全量建表 + 种子数据（依据《数据库设计.md》34 张表）
-- 说明：
--   1. 幂等：DROP TABLE IF EXISTS 后可重复执行（开发期允许重建，上线后禁止）
--   2. 全部显式指定 ENGINE=InnoDB（phpstudy 默认 MyISAM，本系统依赖事务+行锁）
--   3. 外键为逻辑引用（字段注释 → 表.字段），不建物理约束，避免删表顺序问题
--   4. 金额 DECIMAL(12,2)，数量 DECIMAL(12,3)
-- 执行：mysql -uroot -proot wuliaotong < sql/init.sql
-- =====================================================================

SET NAMES utf8mb4;

-- ============================ 1. 用户与权限 ============================

DROP TABLE IF EXISTS sys_user;
CREATE TABLE sys_user (
  id            BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
  username      VARCHAR(50)  NOT NULL COMMENT '登录名',
  password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt 哈希',
  real_name     VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '姓名',
  phone         VARCHAR(20)  NOT NULL DEFAULT '' COMMENT '手机号',
  email         VARCHAR(100) NOT NULL DEFAULT '' COMMENT '邮箱（找回密码用）',
  role_id       BIGINT       NOT NULL COMMENT '角色 → sys_role.id',
  status        TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
  last_login_at DATETIME     NULL COMMENT '最后登录时间',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username),
  KEY idx_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户';


DROP TABLE IF EXISTS sys_register_apply;
CREATE TABLE sys_register_apply (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)  NOT NULL COMMENT '申请登录名',
  password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt 哈希（审核通过后建用户）',
  real_name     VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '姓名',
  phone         VARCHAR(20)  NOT NULL DEFAULT '' COMMENT '手机号',
  email         VARCHAR(100) NOT NULL DEFAULT '' COMMENT '邮箱',
  status        TINYINT      NOT NULL DEFAULT 0 COMMENT '0 待审核 / 1 通过 / 2 拒绝',
  handled_by    BIGINT       NOT NULL DEFAULT 0 COMMENT '审核人',
  handled_at    DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status (status),
  KEY idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='注册申请（审核注册模式）';

DROP TABLE IF EXISTS base_department;
CREATE TABLE base_department (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  code       VARCHAR(30)  NOT NULL COMMENT '单位编码',
  name       VARCHAR(100) NOT NULL COMMENT '单位名称',
  remark     VARCHAR(255) NOT NULL DEFAULT '',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组织单位（部门）';

DROP TABLE IF EXISTS base_department_shelf;
CREATE TABLE base_department_shelf (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  department_id BIGINT NOT NULL COMMENT '→ base_department.id',
  shelf_id      BIGINT NOT NULL COMMENT '→ base_shelf.id',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dept_shelf (department_id, shelf_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='单位-货架关联（单位下可用显示的货架）';

DROP TABLE IF EXISTS sys_role;
CREATE TABLE sys_role (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  code        VARCHAR(30)  NOT NULL COMMENT '角色编码：super_admin/manager/storekeeper/user',
  name        VARCHAR(50)  NOT NULL COMMENT '角色名',
  description VARCHAR(200) NOT NULL DEFAULT '',
  is_builtin  TINYINT      NOT NULL DEFAULT 0 COMMENT '1 内置角色（禁删）',
  department_id BIGINT     NOT NULL DEFAULT 0 COMMENT '所属单位 → base_department.id（控制可见货架）',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色';

DROP TABLE IF EXISTS sys_permission;
CREATE TABLE sys_permission (
  id        BIGINT NOT NULL AUTO_INCREMENT,
  parent_id BIGINT      NOT NULL DEFAULT 0 COMMENT '父级（0 顶级）',
  name      VARCHAR(50) NOT NULL COMMENT '权限名',
  code      VARCHAR(50) NOT NULL COMMENT '权限点编码（《后端API设计.md》§10）',
  type      TINYINT     NOT NULL DEFAULT 2 COMMENT '1 菜单 / 2 按钮',
  sort      INT         NOT NULL DEFAULT 0,
  module_code VARCHAR(50) NOT NULL DEFAULT '' COMMENT '归属模块编码（线缆和设备插件方案 v2.1）：cable/task/knowledge/device，空=核心权限；模块停用时其权限点不生效',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code),
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权限点';

DROP TABLE IF EXISTS sys_role_permission;
CREATE TABLE sys_role_permission (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  role_id       BIGINT NOT NULL COMMENT '→ sys_role.id',
  permission_id BIGINT NOT NULL COMMENT '→ sys_permission.id',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_role_perm (role_id, permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色-权限';

DROP TABLE IF EXISTS sys_session;
CREATE TABLE sys_session (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(64)  NOT NULL COMMENT '随机 token（Cookie 值）',
  user_id    BIGINT       NOT NULL COMMENT '→ sys_user.id',
  ip         VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '登录 IP',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  expire_at  DATETIME     NOT NULL COMMENT '过期时间（滑动续期）',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_session (session_id),
  KEY idx_user (user_id),
  KEY idx_expire (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话（Session 存表）';

-- ============================ 2. 系统 ============================

DROP TABLE IF EXISTS sys_config;
CREATE TABLE sys_config (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  config_key   VARCHAR(50)  NOT NULL COMMENT '配置键',
  config_value TEXT         NOT NULL COMMENT '配置值',
  remark       VARCHAR(200) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置';

DROP TABLE IF EXISTS sys_operation_log;
CREATE TABLE sys_operation_log (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  user_id     BIGINT      NULL COMMENT '操作人（未登录为 NULL）',
  username    VARCHAR(50) NOT NULL DEFAULT '',
  module      VARCHAR(50) NOT NULL DEFAULT '' COMMENT '模块',
  action      VARCHAR(50) NOT NULL DEFAULT '' COMMENT '动作',
  method      VARCHAR(10) NOT NULL DEFAULT '',
  url         VARCHAR(255) NOT NULL DEFAULT '',
  params      TEXT        NULL COMMENT '请求参数 JSON',
  ip          VARCHAR(64) NOT NULL DEFAULT '',
  user_agent  VARCHAR(255) NOT NULL DEFAULT '',
  duration_ms INT         NOT NULL DEFAULT 0,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_time (user_id, created_at),
  KEY idx_module_time (module, created_at),
  KEY idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志';

DROP TABLE IF EXISTS sys_notification;
CREATE TABLE sys_notification (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  user_id    BIGINT      NOT NULL COMMENT '接收人 → sys_user.id',
  title      VARCHAR(100) NOT NULL COMMENT '标题',
  content    VARCHAR(500) NOT NULL DEFAULT '',
  biz_type   VARCHAR(30) NOT NULL DEFAULT '' COMMENT '预警/待办/审批',
  link       VARCHAR(255) NOT NULL DEFAULT '' COMMENT '业务联动跳转目标（移动端路由），兼作业务去重/自动已读唯一键',
  channels   VARCHAR(50) NOT NULL DEFAULT 'internal' COMMENT '投递渠道（逗号分隔）：internal/email/sms（缺省仅站内）',
  is_read    TINYINT     NOT NULL DEFAULT 0 COMMENT '1 已读 / 0 未读',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_read (user_id, is_read),
  KEY idx_user_time (user_id, created_at),
  KEY idx_link (link)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内通知';

DROP TABLE IF EXISTS sys_backup_log;
CREATE TABLE sys_backup_log (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  file_path   VARCHAR(255) NOT NULL,
  file_size   BIGINT NOT NULL DEFAULT 0,
  backup_type VARCHAR(10)  NOT NULL DEFAULT 'auto' COMMENT 'auto 自动 / manual 手动',
  status      TINYINT      NOT NULL DEFAULT 1 COMMENT '1 成功 / 0 失败',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='备份记录';

DROP TABLE IF EXISTS sys_file;
CREATE TABLE sys_file (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  biz_type      VARCHAR(30)  NOT NULL COMMENT 'purchase_bill/purchase_item/requisition_item/product/other',
  biz_id        BIGINT       NOT NULL DEFAULT 0 COMMENT '归属单据或明细 id',
  storage_id    BIGINT       NOT NULL DEFAULT 0 COMMENT '存储位置 → sys_storage.id（多存储地址）',
  original_name VARCHAR(255) NOT NULL DEFAULT '',
  file_path     VARCHAR(255) NOT NULL COMMENT '相对存储根目录的路径',
  file_size     BIGINT       NOT NULL DEFAULT 0,
  md5           CHAR(32)     NOT NULL DEFAULT '',
  uploader_id   BIGINT       NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_biz (biz_type, biz_id),
  KEY idx_storage (storage_id),
  KEY idx_md5 (md5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件/照片（永久保存）';

DROP TABLE IF EXISTS sys_storage;
CREATE TABLE sys_storage (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  name       VARCHAR(50)  NOT NULL COMMENT '存储位置名称',
  type       VARCHAR(20)  NOT NULL DEFAULT 'local' COMMENT 'local 本地目录（当前仅本地）',
  path       VARCHAR(500) NOT NULL COMMENT '存储路径：绝对路径或相对 backend/ 的目录',
  policy     VARCHAR(10)  NOT NULL DEFAULT 'fill' COMMENT '选择策略：fill 最空闲/round 轮询/manual 手动指定',
  is_default TINYINT      NOT NULL DEFAULT 0 COMMENT '1 默认（manual 未指定时使用）',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
  remark     VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='存储位置（多存储地址）';

-- ============================ 2.5 功能模块插件（线缆和设备插件方案 §2.2） ============================

DROP TABLE IF EXISTS sys_module;
CREATE TABLE sys_module (
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

DROP TABLE IF EXISTS sys_module_migration;
CREATE TABLE sys_module_migration (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  module_code VARCHAR(50)  NOT NULL COMMENT '→ sys_module.code',
  version     VARCHAR(50)  NOT NULL COMMENT 'migration 标识（如 0001_initial / baseline）',
  checksum    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT 'migration 文件 sha256',
  success     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 成功 / 0 失败',
  executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_module_version (module_code, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块 migration 执行记录';

DROP TABLE IF EXISTS sys_notification_delivery;
CREATE TABLE sys_notification_delivery (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  notification_id BIGINT   NULL COMMENT '→ sys_notification.id（ON DELETE SET NULL 语义，逻辑引用）',
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

-- ============================ 3. 基础资料 ============================

DROP TABLE IF EXISTS base_supplier;
CREATE TABLE base_supplier (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  code       VARCHAR(30)  NOT NULL COMMENT '供应商编码',
  name       VARCHAR(100) NOT NULL COMMENT '名称',
  contact    VARCHAR(50)  NOT NULL DEFAULT '',
  phone      VARCHAR(20)  NOT NULL DEFAULT '',
  address    VARCHAR(200) NOT NULL DEFAULT '',
  remark     VARCHAR(255) NOT NULL DEFAULT '',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code),
  KEY idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商';

DROP TABLE IF EXISTS base_category;
CREATE TABLE base_category (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  parent_id  BIGINT      NOT NULL DEFAULT 0 COMMENT '父级（0 顶级）',
  name       VARCHAR(50) NOT NULL,
  path       VARCHAR(200) NOT NULL DEFAULT '' COMMENT '如 /1/5/',
  sort       INT         NOT NULL DEFAULT 0,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品分类（多级）';

DROP TABLE IF EXISTS base_product;
CREATE TABLE base_product (
  id             BIGINT NOT NULL AUTO_INCREMENT,
  code           VARCHAR(50)  NOT NULL COMMENT '商品编码（纯数字，系统内部）',
  material_code  VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '物料编码（公司系统编码，空则提示管理员补录）',
  barcode        VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '条码',
  sku            VARCHAR(50)  NOT NULL DEFAULT '',
  name           VARCHAR(100) NOT NULL COMMENT '名称',
  category_id    BIGINT       NOT NULL DEFAULT 0 COMMENT '→ base_category.id',
  spec           VARCHAR(100) NOT NULL DEFAULT '' COMMENT '规格/型号',
  unit_id        BIGINT       NOT NULL DEFAULT 0 COMMENT '基本单位 → base_unit.id',
  purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '进价',
  min_stock      DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT '预警下限',
  max_stock      DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT '预警上限（0 不限制）',
  image_file_id  BIGINT       NOT NULL DEFAULT 0 COMMENT '商品图 → sys_file.id',
  status         TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
  remark         VARCHAR(255) NOT NULL DEFAULT '',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code),
  KEY idx_barcode (barcode),
  KEY idx_material_code (material_code),
  KEY idx_sku (sku),
  KEY idx_name (name),
  KEY idx_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品';

DROP TABLE IF EXISTS base_unit;
CREATE TABLE base_unit (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  name       VARCHAR(20) NOT NULL COMMENT '单位名（件/箱/包）',
  remark     VARCHAR(100) NOT NULL DEFAULT '',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='计量单位';

-- 单位种子（国标法定计量单位 + 常用量词；材料/入库/送货单识别场景的单位下拉均来自本表）
INSERT INTO base_unit (name, remark) VALUES
  ('个', '数量量词'),
  ('件', '数量量词'),
  ('套', '数量量词'),
  ('箱', '包装量词'),
  ('盒', '包装量词'),
  ('包', '包装量词'),
  ('袋', '包装量词'),
  ('罐', '包装量词'),
  ('瓶', '包装量词'),
  ('卷', '包装量词'),
  ('桶', '包装量词'),
  ('坛', '包装量词'),
  ('台', '设备量词'),
  ('辆', '设备量词'),
  ('批', '批量量词'),
  ('只', '数量量词'),
  ('根', '数量量词'),
  ('条', '数量量词'),
  ('块', '数量量词'),
  ('张', '数量量词'),
  ('对', '数量量词'),
  ('副', '数量量词'),
  ('双', '数量量词'),
  ('把', '数量量词'),
  ('支', '数量量词'),
  ('片', '数量量词'),
  ('组', '数量量词'),
  ('打', '数量量词'),
  ('份', '数量量词'),
  ('列', '数量量词'),
  ('米', '长度单位'),
  ('千米', '长度单位'),
  ('分米', '长度单位'),
  ('厘米', '长度单位'),
  ('毫米', '长度单位'),
  ('微米', '长度单位'),
  ('平方米', '面积单位'),
  ('平方厘米', '面积单位'),
  ('立方米', '体积单位'),
  ('升', '体积单位'),
  ('毫升', '体积单位'),
  ('吨', '质量单位'),
  ('千克', '质量单位'),
  ('克', '质量单位'),
  ('毫克', '质量单位'),
  ('时', '时间单位'),
  ('分', '时间单位'),
  ('秒', '时间单位'),
  ('摄氏度', '温度单位'),
  ('度', '平面角单位'),
  ('千瓦时', '能量单位');

DROP TABLE IF EXISTS base_product_unit;
CREATE TABLE base_product_unit (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  product_id BIGINT      NOT NULL COMMENT '→ base_product.id',
  unit_id    BIGINT      NOT NULL COMMENT '→ base_unit.id',
  rate       DECIMAL(12,4) NOT NULL DEFAULT 1 COMMENT '相对基本单位倍数',
  is_default TINYINT     NOT NULL DEFAULT 0 COMMENT '1 默认单位',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_unit (product_id, unit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品多单位换算';

DROP TABLE IF EXISTS base_product_supplier;
CREATE TABLE base_product_supplier (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  product_id BIGINT NOT NULL COMMENT '→ base_product.id',
  supplier_id BIGINT NOT NULL COMMENT '→ base_supplier.id',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_supplier (product_id, supplier_id),
  KEY idx_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='材料-供应商关联';

DROP TABLE IF EXISTS base_warehouse;
CREATE TABLE base_warehouse (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  code       VARCHAR(30)  NOT NULL,
  name       VARCHAR(100) NOT NULL,
  address    VARCHAR(200) NOT NULL DEFAULT '',
  manager_id BIGINT       NOT NULL DEFAULT 0 COMMENT '负责人 → sys_user.id',
  remark     VARCHAR(255) NOT NULL DEFAULT '',
  status     TINYINT      NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库';

DROP TABLE IF EXISTS base_shelf;
CREATE TABLE base_shelf (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  warehouse_id BIGINT      NOT NULL COMMENT '→ base_warehouse.id',
  code         VARCHAR(30) NOT NULL COMMENT '货架编码，如 J01',
  name         VARCHAR(50) NOT NULL DEFAULT '',
  remark       VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wh_code (warehouse_id, code),
  KEY idx_warehouse (warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='货架';

DROP TABLE IF EXISTS base_location;
CREATE TABLE base_location (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  warehouse_id BIGINT      NOT NULL COMMENT '仓库',
  shelf_id     BIGINT      NOT NULL COMMENT '货架',
  layer_no     INT         NOT NULL DEFAULT 1 COMMENT '层号',
  row_no       INT         NOT NULL DEFAULT 1 COMMENT '行号',
  col_no       INT         NOT NULL DEFAULT 1 COMMENT '列号',
  code         VARCHAR(50) NOT NULL COMMENT '库位编码，如 CK01-J01-L1R2C3（层行隔）',
  remark       VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code),
  KEY idx_warehouse (warehouse_id),
  KEY idx_shelf (shelf_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库位（隔：货架内层×行×列定位）';

-- ============================ 4. 库存核心 ============================

DROP TABLE IF EXISTS stk_stock;
CREATE TABLE stk_stock (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  product_id  BIGINT        NOT NULL COMMENT '商品',
  warehouse_id BIGINT       NOT NULL COMMENT '仓库',
  location_id BIGINT        NOT NULL COMMENT '库位',
  qty         DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT '当前数量',
  cost_price  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '移动加权平均成本',
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pwl (product_id, warehouse_id, location_id),
  KEY idx_warehouse (warehouse_id),
  KEY idx_location (location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='实时库存（一切变动的唯一汇总）';

DROP TABLE IF EXISTS stk_stock_log;
CREATE TABLE stk_stock_log (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  product_id   BIGINT        NOT NULL COMMENT '商品',
  warehouse_id BIGINT        NOT NULL COMMENT '仓库',
  location_id  BIGINT        NOT NULL COMMENT '库位',
  change_type  VARCHAR(20)   NOT NULL COMMENT '采购入库/领用出库/报废/报损/盘盈/盘亏/调拨入/调拨出/期初/其他入/其他出',
  bill_type    VARCHAR(30)   NOT NULL DEFAULT '' COMMENT '来源单据类型，如 pch_purchase_in',
  bill_no      VARCHAR(30)   NOT NULL DEFAULT '' COMMENT '来源单据号',
  bill_item_id BIGINT        NOT NULL DEFAULT 0 COMMENT '来源单据明细 id',
  before_qty   DECIMAL(12,3) NOT NULL COMMENT '变动前数量',
  change_qty   DECIMAL(12,3) NOT NULL COMMENT '变动量（正入负出）',
  after_qty    DECIMAL(12,3) NOT NULL COMMENT '变动后数量',
  cost_price   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '本次成本单价',
  photo_file_id BIGINT       NOT NULL DEFAULT 0 COMMENT '拍照留底 → sys_file.id',
  operator_id  BIGINT        NOT NULL DEFAULT 0 COMMENT '操作人',
  remark       VARCHAR(255)  NOT NULL DEFAULT '',
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_product_time (product_id, created_at),
  KEY idx_wh_time (warehouse_id, created_at),
  KEY idx_bill (bill_no),
  KEY idx_bill_item (bill_item_id),
  KEY idx_change_type (change_type),
  KEY idx_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存流水（唯一事实来源）';

DROP TABLE IF EXISTS stk_opening;
CREATE TABLE stk_opening (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  bill_no      VARCHAR(30) NOT NULL COMMENT '单号 QCK...',
  warehouse_id BIGINT      NOT NULL,
  status       TINYINT     NOT NULL DEFAULT 0 COMMENT '0 草稿 / 1 已过账',
  remark       VARCHAR(255) NOT NULL DEFAULT '',
  creator_id   BIGINT      NOT NULL DEFAULT 0,
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bill_no (bill_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='期初库存单';

DROP TABLE IF EXISTS stk_opening_item;
CREATE TABLE stk_opening_item (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  bill_id     BIGINT        NOT NULL COMMENT '→ stk_opening.id',
  product_id  BIGINT        NOT NULL,
  location_id BIGINT        NOT NULL,
  qty         DECIMAL(12,3) NOT NULL,
  cost_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bill (bill_id),
  KEY idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='期初明细';

-- ============================ 5. 采购入库 ============================

DROP TABLE IF EXISTS pch_purchase_in;
CREATE TABLE pch_purchase_in (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  bill_no      VARCHAR(30)  NOT NULL COMMENT '单号 RK...',
  supplier_id  BIGINT       NOT NULL DEFAULT 0 COMMENT '供应商（可空）',
  warehouse_id BIGINT       NOT NULL,
  total_qty    DECIMAL(12,3) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '1 已入库 / 0 草稿 / -1 作废',
  bill_date    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '单据日期',
  operator_id  BIGINT       NOT NULL DEFAULT 0,
  ocr_record_id BIGINT      NOT NULL DEFAULT 0 COMMENT '来源送货单 OCR 识别记录 → ocr_record.id（0=手工录入）',
  ocr_bill_no   VARCHAR(60) NOT NULL DEFAULT '' COMMENT '送货单号（OCR 识别/手工填写，可空）',
  plan_id       BIGINT      NOT NULL DEFAULT 0 COMMENT '来源采购计划单 → pch_purchase_plan.id（0=无计划手工入库）',
  delivery_file_ids TEXT    NULL COMMENT '送货单图片存底：JSON 数组 [file_id,...]，最多 10 张',
  remark       VARCHAR(255) NOT NULL DEFAULT '',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bill_no (bill_no),
  KEY idx_supplier (supplier_id),
  KEY idx_warehouse (warehouse_id),
  KEY idx_ocr (ocr_record_id),
  KEY idx_plan (plan_id),
  KEY idx_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购入库单';

DROP TABLE IF EXISTS pch_purchase_plan;
CREATE TABLE pch_purchase_plan (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  bill_no       VARCHAR(30)  NOT NULL COMMENT '单号 JH...',
  supplier_id   BIGINT       NOT NULL DEFAULT 0 COMMENT '供应商（可空）',
  warehouse_id  BIGINT       NOT NULL,
  total_qty     DECIMAL(12,3) NOT NULL DEFAULT 0,
  total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  status        TINYINT      NOT NULL DEFAULT 0 COMMENT '0 草稿 / 1 已提交 / 2 部分入库 / 3 已完成 / -1 作废',
  plan_date     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '计划日期',
  remark        VARCHAR(255) NOT NULL DEFAULT '',
  creator_id    BIGINT       NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bill_no (bill_no),
  KEY idx_supplier (supplier_id),
  KEY idx_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购计划单';

DROP TABLE IF EXISTS pch_purchase_plan_item;
CREATE TABLE pch_purchase_plan_item (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  plan_id     BIGINT        NOT NULL COMMENT '→ pch_purchase_plan.id',
  product_id  BIGINT        NOT NULL,
  planned_qty DECIMAL(12,3) NOT NULL COMMENT '计划数量（实收数量在入库单上按实际填，可分批）',
  unit_name   VARCHAR(20)   NOT NULL DEFAULT '' COMMENT '单位（快照）',
  est_price   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '预计单价（仅估金额，不影响入库实际价格）',
  amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  remark      VARCHAR(255)  NOT NULL DEFAULT '',
  sort        INT           NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_plan (plan_id),
  KEY idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购计划明细';

DROP TABLE IF EXISTS pch_purchase_in_item;
CREATE TABLE pch_purchase_in_item (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  bill_id       BIGINT        NOT NULL COMMENT '→ pch_purchase_in.id',
  product_id    BIGINT        NOT NULL,
  qty           DECIMAL(12,3) NOT NULL,
  unit_name     VARCHAR(20)   NOT NULL DEFAULT '' COMMENT '本次单位（快照）',
  price         DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  location_id   BIGINT        NOT NULL COMMENT '存储位置（必选库位）',
  photo_file_id BIGINT        NOT NULL DEFAULT 0 COMMENT '库位拍照留底（不强制）',
  sort          INT           NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bill (bill_id),
  KEY idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购入库明细';

-- ============================ 6. 领用出库 ============================

DROP TABLE IF EXISTS out_requisition;
CREATE TABLE out_requisition (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  bill_no      VARCHAR(30)  NOT NULL COMMENT '单号 LL...',
  applicant_id BIGINT       NOT NULL COMMENT '申请人（使用者）→ sys_user.id',
  use_location VARCHAR(100) NOT NULL COMMENT '使用地点（必填）',
  use_reason   VARCHAR(255) NOT NULL COMMENT '因何使用（必填）',
  is_private   TINYINT      NOT NULL DEFAULT 0 COMMENT '私用标记（隐藏触发，仅管理员可见）',
  display_location VARCHAR(100) NOT NULL DEFAULT '' COMMENT '对外掩护使用地点（固定，管理员可改）',
  display_reason   VARCHAR(255) NOT NULL DEFAULT '' COMMENT '对外掩护因何使用（固定，管理员可改）',
  work_photo_file_id BIGINT NOT NULL DEFAULT 0 COMMENT '完成工作照片（工作地点拍照留痕）',
  work_done_at   DATETIME     NULL COMMENT '完成工作时间',
  work_lat       VARCHAR(30)  NOT NULL DEFAULT '' COMMENT '完成工作定位纬度（水印用）',
  work_lng       VARCHAR(30)  NOT NULL DEFAULT '' COMMENT '完成工作定位经度（水印用）',
  location_photo_file_id BIGINT NOT NULL DEFAULT 0 COMMENT '使用地点照片（不强制）',
  warehouse_id BIGINT       NOT NULL COMMENT '出库仓库',
  total_qty    DECIMAL(12,3) NOT NULL DEFAULT 0,
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '1 待审计 / 2 已通过 / 3 已驳回 / 4 已取消',
  audit_by     BIGINT       NOT NULL DEFAULT 0 COMMENT '审计人（仓管员）',
  audit_time   DATETIME     NULL,
  audit_remark VARCHAR(255) NOT NULL DEFAULT '',
  remark       VARCHAR(255) NOT NULL DEFAULT '',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bill_no (bill_no),
  KEY idx_applicant (applicant_id),
  KEY idx_warehouse (warehouse_id),
  KEY idx_audit_by (audit_by),
  KEY idx_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='领用申请单';

DROP TABLE IF EXISTS out_requisition_item;
CREATE TABLE out_requisition_item (
  id             BIGINT NOT NULL AUTO_INCREMENT,
  requisition_id BIGINT        NOT NULL COMMENT '→ out_requisition.id',
  product_id     BIGINT        NOT NULL,
  qty            DECIMAL(12,3) NOT NULL,
  location_id    BIGINT        NOT NULL COMMENT '出库库位',
  photo_file_id  BIGINT        NOT NULL DEFAULT 0 COMMENT '出库商品照片（不强制）',
  sort           INT           NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_requisition (requisition_id),
  KEY idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='领用明细';

-- ============================ 7. 其他出入库 ============================

DROP TABLE IF EXISTS stk_other_io;
CREATE TABLE stk_other_io (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  bill_no      VARCHAR(30)  NOT NULL COMMENT '单号 QT...',
  warehouse_id BIGINT       NOT NULL,
  io_type      VARCHAR(20)  NOT NULL COMMENT '报废/报损/赠品入/赠品出/其他入/其他出',
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '1 已过账 / 0 草稿 / -1 作废',
  operator_id  BIGINT       NOT NULL DEFAULT 0,
  remark       VARCHAR(255) NOT NULL DEFAULT '',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bill_no (bill_no),
  KEY idx_wh_type (warehouse_id, io_type),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='其他出入库单';

DROP TABLE IF EXISTS stk_other_io_item;
CREATE TABLE stk_other_io_item (
  id            BIGINT NOT NULL AUTO_INCREMENT,
  bill_id       BIGINT        NOT NULL,
  product_id    BIGINT        NOT NULL,
  qty           DECIMAL(12,3) NOT NULL,
  location_id   BIGINT        NOT NULL,
  photo_file_id BIGINT        NOT NULL DEFAULT 0,
  sort          INT           NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bill (bill_id),
  KEY idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='其他出入库明细';

-- ============================ 8. 调拨 ============================

DROP TABLE IF EXISTS stk_transfer;
CREATE TABLE stk_transfer (
  id                 BIGINT NOT NULL AUTO_INCREMENT,
  bill_no            VARCHAR(30) NOT NULL COMMENT '单号 DB...',
  from_warehouse_id  BIGINT NOT NULL,
  to_warehouse_id    BIGINT NOT NULL,
  status             TINYINT NOT NULL DEFAULT 0 COMMENT '1 已审核 / 0 草稿 / -1 作废',
  audit_by           BIGINT NOT NULL DEFAULT 0,
  audit_time         DATETIME NULL,
  remark             VARCHAR(255) NOT NULL DEFAULT '',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bill_no (bill_no),
  KEY idx_from_wh (from_warehouse_id),
  KEY idx_to_wh (to_warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调拨单';

DROP TABLE IF EXISTS stk_transfer_item;
CREATE TABLE stk_transfer_item (
  id              BIGINT NOT NULL AUTO_INCREMENT,
  transfer_id     BIGINT        NOT NULL,
  product_id      BIGINT        NOT NULL,
  qty             DECIMAL(12,3) NOT NULL,
  from_location_id BIGINT       NOT NULL,
  to_location_id  BIGINT        NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transfer (transfer_id),
  KEY idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调拨明细';

-- ============================ 9. 盘点 ============================

DROP TABLE IF EXISTS stk_check;
CREATE TABLE stk_check (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  bill_no     VARCHAR(30) NOT NULL COMMENT '单号 PD...',
  warehouse_id BIGINT NOT NULL,
  status      TINYINT NOT NULL DEFAULT 0 COMMENT '0 草稿 / 1 盘点中 / 2 已审核',
  checker_id  BIGINT NOT NULL DEFAULT 0,
  check_date  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remark      VARCHAR(255) NOT NULL DEFAULT '',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bill_no (bill_no),
  KEY idx_wh_status (warehouse_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点单';

DROP TABLE IF EXISTS stk_check_item;
CREATE TABLE stk_check_item (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  check_id    BIGINT        NOT NULL,
  product_id  BIGINT        NOT NULL,
  location_id BIGINT        NOT NULL,
  book_qty    DECIMAL(12,3) NOT NULL COMMENT '账面数量',
  real_qty    DECIMAL(12,3) NULL COMMENT '实盘数量',
  diff_qty    DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT '盘盈+ / 盘亏-',
  photo_file_id BIGINT      NOT NULL DEFAULT 0 COMMENT '盘点拍照记录（可选）→ sys_file.id',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_check (check_id),
  KEY idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点明细';

-- ============================ 10. OCR / 大模型 ============================

DROP TABLE IF EXISTS ocr_record;
CREATE TABLE ocr_record (
  id                BIGINT NOT NULL AUTO_INCREMENT,
  file_id           BIGINT      NOT NULL COMMENT '→ sys_file.id',
  ocr_type          TINYINT     NOT NULL COMMENT '1 送货单 / 2 商品外包装 / 3 标签型号',
  engine            VARCHAR(20) NOT NULL DEFAULT 'paddle' COMMENT 'rapidocr/paddle/mm_llm/deepseek',
  raw_result        JSON        NULL COMMENT '引擎原始输出',
  structured        JSON        NULL COMMENT '结构化结果',
  matched_product_id BIGINT     NOT NULL DEFAULT 0 COMMENT '匹配到的商品',
  match_status      TINYINT     NOT NULL DEFAULT 0 COMMENT '1 已匹配 / 2 未匹配 / 3 人工修正',
  duration_ms       INT         NOT NULL DEFAULT 0,
  user_id           BIGINT      NOT NULL DEFAULT 0,
  created_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_file (file_id),
  KEY idx_time (created_at),
  KEY idx_match (match_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OCR 识别记录';

DROP TABLE IF EXISTS ai_suggestion;
CREATE TABLE ai_suggestion (
  id             BIGINT NOT NULL AUTO_INCREMENT,
  ocr_record_id  BIGINT       NOT NULL COMMENT '→ ocr_record.id',
  product_name   VARCHAR(100) NOT NULL COMMENT '大模型给出的商品名',
  model          VARCHAR(20)  NOT NULL COMMENT 'mm_llm / deepseek',
  suggestion     JSON         NULL COMMENT '建议的商品资料',
  status         TINYINT      NOT NULL DEFAULT 1 COMMENT '1 待处理 / 2 已新增商品 / 3 已忽略',
  new_product_id BIGINT       NOT NULL DEFAULT 0 COMMENT '确认新增后的商品 id',
  handled_by     BIGINT       NOT NULL DEFAULT 0,
  handled_at     DATETIME     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ocr (ocr_record_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='大模型商品建议';

DROP TABLE IF EXISTS sys_delete_review;
CREATE TABLE sys_delete_review (
  id             BIGINT NOT NULL AUTO_INCREMENT,
  biz_type       VARCHAR(20) NOT NULL DEFAULT 'product' COMMENT 'product=停用材料 / category=删除分类',
  target_id      BIGINT      NOT NULL COMMENT '目标对象 id（base_product.id / base_category.id）',
  target_name    VARCHAR(200) NOT NULL DEFAULT '' COMMENT '目标名称快照（审核时对象可能已变）',
  target_desc    VARCHAR(500) NOT NULL DEFAULT '' COMMENT '目标补充信息（编码/规格/路径）',
  reason         VARCHAR(500) NOT NULL DEFAULT '' COMMENT '删除原因（申请人填写，必填）',
  status         TINYINT      NOT NULL DEFAULT 0 COMMENT '0 待审核 / 1 已通过（已删除） / 2 已驳回',
  applicant_id   BIGINT       NOT NULL DEFAULT 0 COMMENT '申请人 → sys_user.id',
  applicant_name VARCHAR(50)  NOT NULL DEFAULT '',
  handled_by     BIGINT       NOT NULL DEFAULT 0 COMMENT '审核人 → sys_user.id',
  handled_at     DATETIME     NULL,
  review_remark  VARCHAR(500) NOT NULL DEFAULT '' COMMENT '审核备注/驳回理由',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status (status),
  KEY idx_target (biz_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='删除审核（物料/分类删除审批流）';

DROP TABLE IF EXISTS sys_menu;
CREATE TABLE sys_menu (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  parent_id   BIGINT       NOT NULL DEFAULT 0 COMMENT '父级（0=顶级分组）',
  name        VARCHAR(50)  NOT NULL COMMENT '菜单名称',
  path        VARCHAR(100) NOT NULL DEFAULT '' COMMENT '路由路径（菜单项）；分组留空',
  icon        VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '图标名（前端 ICON_MAP 注册）',
  perm_code   VARCHAR(100) NOT NULL DEFAULT '' COMMENT '权限码；逗号分隔=任一命中可见；空=公开',
  visible     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 显示 / 0 隐藏',
  sort        INT          NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
  module_code VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '归属模块编码（cable/task/knowledge/device），空=核心菜单；模块未启用时菜单自动隐藏',
  remark      VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='导航菜单（动态菜单管理）';

-- =====================================================================
-- 种子数据
-- =====================================================================

-- 角色（id 固定，角色权限映射依赖）
INSERT INTO sys_role (id, code, name, description, is_builtin) VALUES
  (1, 'super_admin', '超级管理员', '全部权限 + 系统设置', 1),
  (2, 'manager',     '管理者',     '查看报表、经营数据', 1),
  (3, 'storekeeper', '仓管员',     '出入库/盘点/调拨/库存查询/领用审计', 1),
  (4, 'user',        '使用者',     '材料领用申请（使用地点、因何使用必填）', 1),
  (5, 'dispatcher',  '调度员',     '线缆/故障/地图缓存/任务派发验收/设备管理/知识（线缆和设备插件方案 §8.2，模块权限随模块安装授予）', 1),
  (6, 'repairer',    '维修人员',   '领用申请、库存查询、线缆查看、故障上报、任务处理、设备任务、知识查看（合并原使用者+巡检）', 1);

-- 权限点（《后端API设计.md》§10，id 固定）
INSERT INTO sys_permission (id, name, code, type, sort) VALUES
  (1,  '商品管理',      'base:product',        2, 10),
  (2,  '分类管理',      'base:category',       2, 11),
  (3,  '仓库管理',      'base:warehouse',      2, 12),
  (4,  '供应商管理',    'base:supplier',       2, 13),
  (5,  '库位维护',      'base:stock-location', 2, 14),
  (6,  '入库',           'pch:in',              2, 20),
  (7,  '送货单 OCR',    'pch:ocr',             2, 21),
  (8,  '库存查询',      'stk:query',           2, 30),
  (9,  '库存流水',      'stk:flow',            2, 31),
  (10, '调拨',          'stk:transfer',        2, 32),
  (11, '盘点',          'stk:check',           2, 33),
  (12, '其他出入库',    'stk:other',           2, 34),
  (13, '领用申请',      'req:apply',           2, 40),
  (14, '领用审计',      'req:audit',           2, 41),
  (15, '拍照识别',      'ocr:use',             2, 50),
  (16, '识别记录管理',  'ocr:manage',          2, 51),
  (17, '报表查看',      'report:view',         2, 60),
  (18, '报表导出',      'report:export',       2, 61),
  (19, '用户管理',      'sys:user',            2, 70),
  (20, '角色权限',      'sys:role',            2, 71),
  (21, '操作日志',      'sys:log',             2, 72),
  (22, '系统设置',      'sys:config',          2, 73),
  (23, '备份管理',      'sys:backup',          2, 74),
  (24, '单位管理',      'dept:manage',         2, 75),
  (25, 'AI 调用日志',   'sys:llm-log',         2, 76),
  (26, 'AI 建议处理',   'ai:suggestion',       2, 62),
  (27, '安装模块',      'module:manage',       2, 77);

-- 角色-权限映射
-- 超级管理员：全部
INSERT INTO sys_role_permission (role_id, permission_id)
  SELECT 1, id FROM sys_permission;
-- 管理者：报表 + 库存查询/流水 + 物料数据管理（base:product/base:category，合并页与删除审核用）
INSERT INTO sys_role_permission (role_id, permission_id) VALUES
  (2, 8), (2, 9), (2, 17), (2, 18), (2, 1), (2, 2);
-- 仓管员：基础资料 + 采购 + 库存 + 审计 + OCR + AI 建议处理
INSERT INTO sys_role_permission (role_id, permission_id) VALUES
  (3, 1), (3, 2), (3, 3), (3, 4), (3, 5),
  (3, 6), (3, 7), (3, 8), (3, 9), (3, 10), (3, 11), (3, 12),
  (3, 14), (3, 15), (3, 16), (3, 26);
-- 使用者：领用申请 + 库存查询（自己相关）
INSERT INTO sys_role_permission (role_id, permission_id) VALUES
  (4, 13), (4, 8);
-- 维修人员：核心权限（领用申请 + 库存查询）；线缆/故障/任务/设备/知识权限随模块安装授予
INSERT INTO sys_role_permission (role_id, permission_id) VALUES
  (6, 13), (6, 8);

-- 导航菜单种子（id 固定；perm_code 逗号分隔=任一命中可见；后续可在「系统管理 → 导航管理」动态调整）
INSERT INTO sys_menu (id, parent_id, name, path, icon, perm_code, visible, sort) VALUES
  (1, 0, '工作台',   '', 'DashboardOutlined', '', 1, 10),
  (2, 1, '统计面板', '/dashboard', 'DashboardOutlined', 'report:view', 1, 10),
  (3, 0, '基础资料', '', 'ShopOutlined', '', 1, 20),
  (4, 3, '物料数据管理', '/materials-data', 'AppstoreOutlined', 'base:product,base:category', 1, 10),
  (5, 3, '删除审核', '/delete-reviews', 'AuditOutlined', 'base:product,base:category', 1, 20),
  (6, 3, '供应商管理', '/suppliers', 'ContactsOutlined', 'base:supplier', 1, 30),
  (7, 3, '材料单位管理', '/units', 'NumberOutlined', 'base:product', 1, 40),
  (8, 0, '入库管理', '', 'InboxOutlined', '', 1, 30),
  (9, 8, '采购计划单', '/purchase-plans', 'FileTextOutlined', 'pch:in', 1, 10),
  (10, 8, '材料入库', '/purchase-in', 'InboxOutlined', 'pch:in', 1, 20),
  (11, 8, '送货单识别入库', '/ocr/delivery', 'FileSearchOutlined', 'pch:ocr', 1, 30),
  (12, 0, '库存管理', '', 'DatabaseOutlined', '', 1, 40),
  (13, 12, '库存查询', '/stock', 'TableOutlined', 'stk:query', 1, 10),
  (14, 12, '仓库与货架', '/warehouses', 'BankOutlined', 'base:warehouse', 1, 20),
  (15, 12, '历史价格管理', '/history-price', 'LineChartOutlined', 'stk:query', 1, 30),
  (16, 12, '库存调拨', '/transfers', 'SwapOutlined', 'stk:transfer', 1, 40),
  (17, 12, '其他出入库', '/other-io', 'ExportOutlined', 'stk:other', 1, 50),
  (18, 0, '领用管理', '', 'EditOutlined', '', 1, 50),
  (19, 18, '领用申请', '/requisitions/apply', 'EditOutlined', 'req:apply', 1, 10),
  (20, 18, '领用申请单查询', '/requisitions/query', 'SearchOutlined', 'req:audit', 1, 20),
  (21, 18, '领用审计', '/requisitions', 'AuditOutlined', 'req:audit', 1, 30),
  (22, 0, '报表中心', '', 'FundOutlined', '', 1, 60),
  (23, 22, '报表中心', '/reports', 'FundOutlined', 'report:view', 1, 10),
  (24, 22, '盘点', '/checks', 'ProfileOutlined', 'stk:check', 1, 20),
  (25, 22, 'AI 建议处理', '/ai-suggestions', 'RobotOutlined', 'ai:suggestion', 1, 30),
  (26, 0, '系统管理', '', 'SettingOutlined', '', 1, 70),
  (27, 26, '用户管理', '/system/users', 'UserOutlined', 'sys:user', 1, 10),
  (28, 26, '用户权限设置', '/system/roles', 'SafetyCertificateOutlined', 'sys:role', 1, 20),
  (29, 26, '注册审核', '/system/register-applies', 'AuditOutlined', 'sys:user', 1, 30),
  (30, 26, '单位管理', '/system/departments', 'ApartmentOutlined', 'dept:manage', 1, 40),
  (31, 26, '导航管理', '/system/menus', 'MenuOutlined', 'sys:role', 1, 45),
  (32, 26, '操作日志', '/system/logs', 'FileTextOutlined', 'sys:log', 1, 50),
  (33, 26, '备份管理', '/system/backups', 'HddOutlined', 'sys:backup', 1, 60),
  (34, 26, 'AI 调用日志', '/llm-logs', 'RobotOutlined', 'sys:llm-log', 1, 70),
  (35, 26, '系统设置', '/system/settings', 'SettingOutlined', 'sys:config', 1, 80),
  (36, 26, '安装模块', '/system/modules', 'AppstoreAddOutlined', 'module:manage', 1, 25);

-- 初始管理员占位（不可登录）：密码哈希为无效值，必须通过「初始化安装向导」设置密码后方可登录。
-- 若手工导入本脚本部署，请执行安装向导（删除 backend/data/.initialized 后访问系统入口），
-- 或自行用 bcrypt 生成哈希后 UPDATE 本行密码（严禁使用固定默认口令）。
INSERT INTO sys_user (id, username, password_hash, real_name, role_id, status) VALUES
  (1, 'admin', '!', '超级管理员', 1, 1);

-- 系统配置
INSERT INTO sys_config (config_key, config_value, remark) VALUES
  ('site.name',            '物料通管理系统', '系统名称'),
  ('session.expire_hours', '8',             '会话过期时间（小时，滑动续期）'),
  ('ocr.engine',           'paddle',        'OCR 引擎：paddle（默认）/ rapidocr'),
  ('bill.rule',            'RK|LL|DB|PD|QT|QCK', '单据编号前缀（单据类型|采购入库|领用|调拨|盘点|其他|期初）'),
  ('watermark.template',   '地点：{location}｜时间：{time}｜坐标：{gps}', '完成工作照片水印模板（占位符 {location} 使用地点 / {time} 完成时间 / {gps} 定位坐标）'),
  ('watermark.position',   'bottom', '完成工作照片水印位置（bottom/top/bottom-left/bottom-right/top-left/top-right）'),
  ('storage.round_seq',    '0',             '轮询策略当前序号（勿手动改）'),
  ('auth.register_mode',   'closed',        '注册模式：open 开放注册 / closed 关闭注册 / review 审核注册'),
  ('auth.forgot_method',   'phone',         '找回密码方式：email 邮箱找回 / phone 联系管理员电话 / both 两者'),
  ('site.contact_phone',   '',              '管理员联系电话（电话找回时展示）'),
  ('smtp.host',            '',              'SMTP 服务器地址（邮箱找回用）'),
  ('smtp.port',            '465',           'SMTP 端口'),
  ('smtp.user',            '',              'SMTP 账号'),
  ('smtp.password',        '',              'SMTP 密码（secret）'),
  ('smtp.from',            '',              '发件人邮箱'),
  ('sms.provider',         '',              '短信服务商：aliyun/tencent/ronglian/http（线缆和设备插件方案 §4.6）'),
  ('sms.key',              '',              '短信 AccessKey（secret，接口脱敏）'),
  ('sms.secret',           '',              '短信 AccessKey Secret（secret，接口脱敏）'),
  ('sms.sign',             '',              '短信签名'),
  ('sms.endpoint',         '',              '短信接口地址（通用 HTTP 服务商）');

-- 注：初始化完成状态不再存 sys_config（sys.initialized 已移除）——改为文件系统标记
-- backend/data/.initialized 判断（见《后端API设计.md》§1.1），数据库重建/备份恢复不会
-- 强制重新进入初始化流程。首次部署请勿提交该标记文件（backend/data/ 已 gitignore）。

-- 默认存储位置（相对 backend/ 解析；后续可在后台新增多存储地址）
INSERT INTO sys_storage (id, name, type, path, policy, is_default, status) VALUES
  (1, '本地默认存储', 'local', 'data/files', 'fill', 1, 1);

-- AI 大模型调用日志（P9：所有大模型调用的输入/输出/耗时/成败，供后期调整与学习）
CREATE TABLE IF NOT EXISTS sys_llm_log (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  scene       VARCHAR(50) NOT NULL DEFAULT '' COMMENT '调用场景（如 ocr_correct/alert_text/dedupe/req_summary/vision_delivery）',
  model       VARCHAR(50) NOT NULL DEFAULT '' COMMENT '模型名（siliconflow/deepseek/mm_llm）',
  prompt      TEXT NULL COMMENT '输入（文本消息；图片仅记张数，省略 base64）',
  output      TEXT NULL COMMENT '模型输出（截断保存）',
  status      VARCHAR(10) NOT NULL DEFAULT 'ok' COMMENT 'ok / error',
  error       TEXT NULL COMMENT '错误信息（失败时）',
  duration_ms INT NOT NULL DEFAULT 0 COMMENT '调用耗时毫秒',
  user_id     BIGINT NULL COMMENT '触发用户（后台任务为空）',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_llm_scene_time (scene, created_at),
  KEY idx_llm_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='大模型调用日志';
