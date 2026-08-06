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
  role_id       BIGINT       NOT NULL COMMENT '角色 → sys_role.id',
  status        TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
  last_login_at DATETIME     NULL COMMENT '最后登录时间',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username),
  KEY idx_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户';

DROP TABLE IF EXISTS sys_role;
CREATE TABLE sys_role (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  code        VARCHAR(30)  NOT NULL COMMENT '角色编码：super_admin/manager/storekeeper/user',
  name        VARCHAR(50)  NOT NULL COMMENT '角色名',
  description VARCHAR(200) NOT NULL DEFAULT '',
  is_builtin  TINYINT      NOT NULL DEFAULT 0 COMMENT '1 内置角色（禁删）',
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
  KEY idx_module_time (module, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志';

DROP TABLE IF EXISTS sys_notification;
CREATE TABLE sys_notification (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  user_id    BIGINT      NOT NULL COMMENT '接收人 → sys_user.id',
  title      VARCHAR(100) NOT NULL COMMENT '标题',
  content    VARCHAR(500) NOT NULL DEFAULT '',
  biz_type   VARCHAR(30) NOT NULL DEFAULT '' COMMENT '预警/待办/审批/ocr',
  is_read    TINYINT     NOT NULL DEFAULT 0 COMMENT '1 已读 / 0 未读',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_read (user_id, is_read),
  KEY idx_user_time (user_id, created_at)
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
  KEY idx_storage (storage_id)
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
  code           VARCHAR(50)  NOT NULL COMMENT '商品编码',
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
  KEY idx_warehouse (warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='货架';

DROP TABLE IF EXISTS base_location;
CREATE TABLE base_location (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  warehouse_id BIGINT      NOT NULL COMMENT '仓库',
  shelf_id     BIGINT      NOT NULL COMMENT '货架',
  layer_no     INT         NOT NULL COMMENT '层号',
  code         VARCHAR(50) NOT NULL COMMENT '库位编码，如 CK01-J01-03',
  remark       VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code),
  KEY idx_warehouse (warehouse_id),
  KEY idx_shelf (shelf_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库位（仓库-货架-层）';

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
  KEY idx_bill (bill_no),
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
  KEY idx_bill (bill_id)
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
  remark       VARCHAR(255) NOT NULL DEFAULT '',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bill_no (bill_no),
  KEY idx_supplier (supplier_id),
  KEY idx_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购入库单';

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
  KEY idx_bill (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购入库明细';

-- ============================ 6. 领用出库 ============================

DROP TABLE IF EXISTS out_requisition;
CREATE TABLE out_requisition (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  bill_no      VARCHAR(30)  NOT NULL COMMENT '单号 LL...',
  applicant_id BIGINT       NOT NULL COMMENT '申请人（使用者）→ sys_user.id',
  use_location VARCHAR(100) NOT NULL COMMENT '使用地点（必填）',
  use_reason   VARCHAR(255) NOT NULL COMMENT '因何使用（必填）',
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
  KEY idx_requisition (requisition_id)
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
  UNIQUE KEY uk_bill_no (bill_no)
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
  KEY idx_bill (bill_id)
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
  UNIQUE KEY uk_bill_no (bill_no)
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
  KEY idx_transfer (transfer_id)
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
  UNIQUE KEY uk_bill_no (bill_no)
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
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_check (check_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点明细';

-- ============================ 10. OCR / 大模型 ============================

DROP TABLE IF EXISTS ocr_record;
CREATE TABLE ocr_record (
  id                BIGINT NOT NULL AUTO_INCREMENT,
  file_id           BIGINT      NOT NULL COMMENT '→ sys_file.id',
  ocr_type          TINYINT     NOT NULL COMMENT '1 送货单 / 2 商品外包装 / 3 标签型号',
  engine            VARCHAR(20) NOT NULL DEFAULT 'rapidocr' COMMENT 'rapidocr/paddle/doubao/deepseek',
  raw_result        JSON        NULL COMMENT '引擎原始输出',
  structured        JSON        NULL COMMENT '结构化结果',
  matched_product_id BIGINT     NOT NULL DEFAULT 0 COMMENT '匹配到的商品',
  match_status      TINYINT     NOT NULL DEFAULT 0 COMMENT '1 已匹配 / 2 未匹配 / 3 人工修正',
  duration_ms       INT         NOT NULL DEFAULT 0,
  user_id           BIGINT      NOT NULL DEFAULT 0,
  created_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_time (created_at),
  KEY idx_match (match_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OCR 识别记录';

DROP TABLE IF EXISTS ai_suggestion;
CREATE TABLE ai_suggestion (
  id             BIGINT NOT NULL AUTO_INCREMENT,
  ocr_record_id  BIGINT       NOT NULL COMMENT '→ ocr_record.id',
  product_name   VARCHAR(100) NOT NULL COMMENT '大模型给出的商品名',
  model          VARCHAR(20)  NOT NULL COMMENT 'doubao / deepseek',
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

-- =====================================================================
-- 种子数据
-- =====================================================================

-- 角色（id 固定，角色权限映射依赖）
INSERT INTO sys_role (id, code, name, description, is_builtin) VALUES
  (1, 'super_admin', '超级管理员', '全部权限 + 系统设置', 1),
  (2, 'manager',     '管理者',     '查看报表、经营数据', 1),
  (3, 'storekeeper', '仓管员',     '出入库/盘点/调拨/库存查询/领用审计', 1),
  (4, 'user',        '使用者',     '材料领用申请（使用地点、因何使用必填）', 1);

-- 权限点（《后端API设计.md》§10，id 固定）
INSERT INTO sys_permission (id, name, code, type, sort) VALUES
  (1,  '商品管理',      'base:product',        2, 10),
  (2,  '分类管理',      'base:category',       2, 11),
  (3,  '仓库管理',      'base:warehouse',      2, 12),
  (4,  '供应商管理',    'base:supplier',       2, 13),
  (5,  '库位维护',      'base:stock-location', 2, 14),
  (6,  '采购入库',      'pch:in',              2, 20),
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
  (23, '备份管理',      'sys:backup',          2, 74);

-- 角色-权限映射
-- 超级管理员：全部
INSERT INTO sys_role_permission (role_id, permission_id)
  SELECT 1, id FROM sys_permission;
-- 管理者：报表 + 库存查询/流水
INSERT INTO sys_role_permission (role_id, permission_id) VALUES
  (2, 8), (2, 9), (2, 17), (2, 18);
-- 仓管员：基础资料 + 采购 + 库存 + 审计 + OCR
INSERT INTO sys_role_permission (role_id, permission_id) VALUES
  (3, 1), (3, 2), (3, 3), (3, 4), (3, 5),
  (3, 6), (3, 7), (3, 8), (3, 9), (3, 10), (3, 11), (3, 12),
  (3, 14), (3, 15), (3, 16);
-- 使用者：领用申请 + 库存查询（自己相关）
INSERT INTO sys_role_permission (role_id, permission_id) VALUES
  (4, 13), (4, 8);

-- 初始管理员（admin / admin123，首次登录后请立即修改）
INSERT INTO sys_user (id, username, password_hash, real_name, role_id, status) VALUES
  (1, 'admin', '$2b$12$UABpNCWCLt2fMHlSG6wF4eYGVmnuJnD2zQB4TH.vci8PL9qLXnYoO', '超级管理员', 1, 1);

-- 系统配置
INSERT INTO sys_config (config_key, config_value, remark) VALUES
  ('site.name',            '物料通管理系统', '系统名称'),
  ('session.expire_hours', '8',             '会话过期时间（小时，滑动续期）'),
  ('ocr.engine',           'rapidocr',      'OCR 引擎：rapidocr / paddle'),
  ('bill.rule',            'RK|LL|DB|PD|QT|QCK', '单据编号前缀（单据类型|采购入库|领用|调拨|盘点|其他|期初）'),
  ('storage.round_seq',    '0',             '轮询策略当前序号（勿手动改）');

-- 默认存储位置（相对 backend/ 解析；后续可在后台新增多存储地址）
INSERT INTO sys_storage (id, name, type, path, policy, is_default, status) VALUES
  (1, '本地默认存储', 'local', 'data/files', 'fill', 1, 1);
