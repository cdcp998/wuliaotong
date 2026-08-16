-- 存量数据库索引升级脚本（安全审计修复配套）
-- 使用方式：mysql -u<user> -p <db_name> < backend/sql/upgrade_indexes.sql
-- 说明：
--   1. 新装环境已包含在 init.sql 中，无需执行本脚本；
--   2. 全部语句幂等性由索引名保证；重复执行时已存在的索引会报
--      "Duplicate key name"，属预期，可忽略（不影响其余语句）；
--   3. base_shelf 的 UNIQUE(warehouse_id, code) 若因历史重复数据创建失败，
--      请先人工清理重复货架编码后再执行该语句。

-- 库存流水：按仓库时间、明细、变动类型过滤（报表/流水列表全表扫描 → 走索引）
ALTER TABLE stk_stock_log ADD INDEX idx_wh_time (warehouse_id, created_at);
ALTER TABLE stk_stock_log ADD INDEX idx_bill_item (bill_item_id);
ALTER TABLE stk_stock_log ADD INDEX idx_change_type (change_type);

-- 商品：物料编码/规格编码精确匹配（导入查重、OCR 匹配）
ALTER TABLE base_product ADD INDEX idx_material_code (material_code);
ALTER TABLE base_product ADD INDEX idx_sku (sku);

-- 操作日志：按用户名过滤
ALTER TABLE sys_operation_log ADD INDEX idx_username (username);

-- 文件：md5 去重
ALTER TABLE sys_file ADD INDEX idx_md5 (md5);

-- 货架：同仓库内编码唯一（防并发/重复录入）
ALTER TABLE base_shelf ADD UNIQUE KEY uk_wh_code (warehouse_id, code);

-- 采购入库单：按仓库/OCR 记录过滤
ALTER TABLE pch_purchase_in ADD INDEX idx_warehouse (warehouse_id);
ALTER TABLE pch_purchase_in ADD INDEX idx_ocr (ocr_record_id);

-- 领用申请单：按仓库/审计人过滤
ALTER TABLE out_requisition ADD INDEX idx_warehouse (warehouse_id);
ALTER TABLE out_requisition ADD INDEX idx_audit_by (audit_by);

-- 其他出入库单：按仓库+类型/状态过滤
ALTER TABLE stk_other_io ADD INDEX idx_wh_type (warehouse_id, io_type);
ALTER TABLE stk_other_io ADD INDEX idx_status (status);

-- 调拨单：按调出/调入仓库过滤
ALTER TABLE stk_transfer ADD INDEX idx_from_wh (from_warehouse_id);
ALTER TABLE stk_transfer ADD INDEX idx_to_wh (to_warehouse_id);

-- 盘点单：按仓库+状态过滤
ALTER TABLE stk_check ADD INDEX idx_wh_status (warehouse_id, status);

-- OCR 记录：按来源文件查询
ALTER TABLE ocr_record ADD INDEX idx_file (file_id);

-- 六张单据明细表：按商品过滤（统计/关联查询）
ALTER TABLE stk_opening_item ADD INDEX idx_product (product_id);
ALTER TABLE pch_purchase_in_item ADD INDEX idx_product (product_id);
ALTER TABLE out_requisition_item ADD INDEX idx_product (product_id);
ALTER TABLE stk_other_io_item ADD INDEX idx_product (product_id);
ALTER TABLE stk_transfer_item ADD INDEX idx_product (product_id);
ALTER TABLE stk_check_item ADD INDEX idx_product (product_id);

-- 初始化防重置：为存量部署补写初始化时间戳（/api/v1/init 依赖该配置拒绝重复初始化）。
-- 已初始化过的库执行后，即使 backend/data/.initialized 标记文件被误删也无法重装重置超管。
INSERT INTO sys_config (config_key, config_value, remark)
SELECT 'system.init_ts', NOW(), '存量升级补写：禁止重复初始化'
WHERE NOT EXISTS (SELECT 1 FROM sys_config WHERE config_key = 'system.init_ts');
