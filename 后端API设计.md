# 物料通管理系统 —— 后端 API 设计

> FastAPI + Python 3.13 + MySQL；依据《需求大纲.md》《数据库设计.md》（2026-03-31 确认版）

## 0. 总体约定

- 路径前缀：`/api/v1`；请求/响应均为 JSON（文件上传除外）
- 统一响应体：`{"code": 0, "message": "ok", "data": ...}`；`code != 0` 为业务错误
- 分页：`?page=1&page_size=20`，data 返回 `{list, total, page, page_size}`
- 认证：Session Cookie（HttpOnly + Secure），登录接口下发；除登录外所有接口校验会话
- 权限：依赖注入 `require_permission("权限code")`，权限点清单见第 10 节
- 审计：所有写操作（POST/PUT/DELETE）由中间件自动记录 `sys_operation_log`
- 金额/数量：接口传输字符串（如 "12.50"），避免浮点精度问题；服务端 Decimal 计算
- 时间：`YYYY-MM-DD HH:mm:ss`；单据日期默认当天
- 图片上传：multipart，单张 ≤10MB，服务端 Pillow 压缩（WebP q80，长边≤1600px），永久保存

## 1. 认证与用户管理

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | /auth/login | {username, password} → 写 session，返回用户信息 | 公开 |
| POST | /auth/logout | 注销会话 | 登录 |
| GET | /auth/me | 当前用户 + 角色 + 权限点列表 | 登录 |
| PUT | /auth/password | 修改自己密码 {old_password, new_password} | 登录 |
| GET | /users?keyword=&page= | 用户列表 | sys:user |
| POST | /users | 新增用户（含 role_id、初始密码） | sys:user |
| PUT | /users/{id} | 修改用户 | sys:user |
| PUT | /users/{id}/status | 启用/停用 {status} | sys:user |
| PUT | /users/{id}/password | 重置密码 | sys:user |
| GET | /roles | 角色列表 | sys:user |
| POST / PUT / DELETE | /roles, /roles/{id} | 角色维护（内置角色禁删） | sys:user |
| GET | /roles/{id}/permissions | 角色权限点 id 列表 | sys:user |
| PUT | /roles/{id}/permissions | 保存角色权限点 {permission_ids: []} | sys:user |
| GET | /permissions | 权限点树（菜单+按钮） | sys:user |

登录示例：
```
POST /api/v1/auth/login
{"username": "zhangsan", "password": "******"}
→ 200 {"code": 0, "data": {"id": 1, "real_name": "张三", "role_code": "storekeeper",
     "permissions": ["stock:query", "stock:in", ...]}}
```

## 2. 基础资料

**商品**
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /products?keyword=&category_id=&barcode=&status=&page= | 列表（keyword 匹配名称/编码/SKU/条码） |
| POST | /products | 新增 {code, barcode, sku, name, category_id, spec, unit_id, purchase_price, min_stock, max_stock, image_file_id, units:[{unit_id, rate, is_default}]} |
| GET / PUT | /products/{id} | 详情 / 修改 |
| POST | /products/import | Excel 批量导入，返回 {success_count, fail_rows:[{row, reason}]} |
| GET | /products/export?keyword= | Excel 导出 |

**分类 / 单位 / 供应商 / 仓库 / 货架 / 库位**（CRUD 同构，不再展开）
- GET /categories（树）、POST /categories、PUT/DELETE /categories/{id}
- GET /units、POST /units
- GET/POST /suppliers、PUT/DELETE /suppliers/{id}、POST /suppliers/import
- GET/POST /warehouses、PUT/DELETE /warehouses/{id}
- GET /warehouses/{id}/shelves、POST /shelves、PUT/DELETE /shelves/{id}
- GET /locations?warehouse_id=&shelf_id=（2D 货架图数据源）、POST /locations {warehouse_id, shelf_id, layer_no}、PUT/DELETE /locations/{id}

**期初库存**
- POST /opening（草稿，头+明细）、GET /opening、GET/PUT /opening/{id}
- POST /opening/{id}/post → 过账：事务写期初流水 + 初始化 stk_stock，过账后锁定
- POST /opening/import（Excel 导入明细）

## 3. 采购入库

- POST /purchase-in → 保存即入库
  body: `{supplier_id, warehouse_id, bill_date, remark, items: [{product_id, qty, unit_name, price, location_id, photo_file_id}]}`
  服务端：生成单号 RK... → 事务写流水 + 更新 stk_stock（移动加权成本）→ 状态=已入库
- GET /purchase-in?bill_no=&supplier_id=&warehouse_id=&start=&end=&status=&page=
- GET /purchase-in/{id}（含明细、照片、流水）
- POST /purchase-in/{id}/void → 作废：事务反向冲销流水（仅当日可作废）
- POST /purchase-in/ocr {file_id} → 识别送货单（RapidOCR 异步），返回 ocr_task_id；完成后站内通知，结果含提取的商品/数量/金额待人工确认
- GET /ocr/tasks/{task_id}（见第 7 节，轮询用）

## 4. 领用（使用者手机端核心流程）

- POST /requisitions
  body: `{warehouse_id, use_location(必填), use_reason(必填), remark, items: [{product_id, qty, location_id, photo_file_id}]}`
  → 状态=待审计，返回 {bill_no}；出库商品照片不强制
- GET /requisitions/my?status=&page= 我的申请（使用者）
- GET /requisitions?status=1&keyword=&page= 待审计列表（仓管员）
- GET /requisitions/{id} 详情（含明细+照片+审计记录）
- PUT /requisitions/{id} 修改（仅"已驳回"状态可改后重新提交）
- POST /requisitions/{id}/cancel 取消（仅"待审计"状态）
- POST /requisitions/{id}/audit {action: "approve"|"reject", remark}
  - approve：事务内 `SELECT ... FOR UPDATE` 锁 stk_stock → 逐条校验库存充足（不足则整单失败并返回明细）→ 扣库存 → 写流水 → 状态=已通过 → 通知申请人
  - reject：状态=已驳回 → 通知申请人

## 5. 调拨 / 盘点 / 其他出入库

- POST /transfers {from_warehouse_id, to_warehouse_id, items:[{product_id, qty, from_location_id, to_location_id}]} → 草稿
- POST /transfers/{id}/audit → 审核过账（同事务：调出仓扣、调入仓加、两条流水）
- GET /transfers、GET /transfers/{id}、POST /transfers/{id}/void
- POST /checks {warehouse_id} → 创建盘点单，自动带出账面明细（book_qty）
- PUT /checks/{id}/items {items:[{check_item_id, real_qty}]} 录入实盘
- POST /checks/{id}/audit → 审核：按 diff_qty 生成盘盈/盘亏流水
- GET /checks、GET /checks/{id}（支持复盘：重新建单）
- POST /other-io {io_type: 报废/报损/赠品入/赠品出/其他入/其他出, warehouse_id, items:[{product_id, qty, location_id, photo_file_id}]} → 直接过账
- GET /other-io、GET /other-io/{id}、POST /other-io/{id}/void

## 6. 库存查询

- GET /stock?product_id=&warehouse_id=&location_id=&keyword=&alert=0&page=
  data.list: [{product_id, product_name, barcode, spec, warehouse_name, location_code, qty, cost_price, amount}]
- GET /stock/flow?product_id=&bill_no=&change_type=&start=&end=&page= 库存流水
- GET /stock/alerts → 低于下限/高于上限商品清单（与站内通知同数据源）
- GET /stock/summary → 看板：SKU 数、总件数、今日入库/出库件数、预警数、待审计单数、近 7 日出入库趋势

## 7. 文件 / OCR / 大模型

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /files/upload | multipart(file, biz_type, biz_id?) → {file_id, url}，自动压缩 |
| POST | /ocr/recognize | {file_id, ocr_type: 1送货单/2商品外包装/3标签型号} → {task_id}；按 sys_config 选中的引擎异步识别（rapidocr / paddle） |
| GET | /ocr/tasks/{task_id} | {status: running/done/failed, structured, record_id} 轮询 |
| POST | /ocr/confirm | {record_id, structured} 人工修正确认（match_status=3） |
| POST | /ocr/match | {record_id} 未匹配商品 → 豆包视觉识别 → 生成 ai_suggestion → 站内通知 |
| GET | /ocr/records?date=&match_status=&page= | 识别历史 |
| POST | /ai-suggestions/{id}/accept | {name, spec, category_id, purchase_price...} 确认新增商品并回写 |
| POST | /ai-suggestions/{id}/ignore | 忽略建议 |
| POST | /barcode/decode | 上传条码图片，zxing-cpp 解码返回条码值（手机端也可前端直接扫） |

OCR 结果示例（structured）：
```json
{"items": [{"product_name": "轴承6204", "qty": "10", "price": "8.50", "amount": "85.00",
            "match_status": "matched", "matched_product_id": 102}],
 "supplier_name": "华东五金", "bill_no": "HD-20260330-001"}
```

## 8. 报表

- GET /reports/inventory-summary?warehouse_id=&start=&end=&page= → 按商品：期初 + 入库 - 出库 = 结存（聚合 stk_stock_log）
- GET /reports/stock?sort=qty|amount|turnover → 库存余额 / 周转 / 呆滞（>90 天未变动）
- GET /reports/dashboard → 经营看板数据（今日/本周/本月出入库、预警、待办）
- GET /reports/export?type=inventory-summary|stock|flow&...= → Excel 文件流（openpyxl）

## 9. 系统管理

- GET /settings、PUT /settings（公司信息、单据编号规则、OCR 引擎参数、大模型 Key/BaseURL、预警参数）
- GET /operation-logs?user_id=&module=&start=&end=&page=
- GET /notifications?is_read=&page=、PUT /notifications/{id}/read、PUT /notifications/read-all、GET /notifications/unread-count
- POST /backup（手动备份 mysqldump）、GET /backups
- GET /health（服务 + 当前 OCR 引擎类型与状态，部署/运维用）

## 10. 权限点 code 清单（sys_permission 初始化数据）

| code | 说明 | 分配角色 |
|---|---|---|
| base:product / base:category / base:warehouse / base:supplier | 基础资料维护 | 超级管理员/仓管员 |
| base:stock-location | 库位维护 | 超级管理员/仓管员 |
| pch:in | 采购入库 | 仓管员 |
| pch:ocr | 送货单 OCR 录入 | 仓管员 |
| stk:query / stk:flow | 库存查询/流水 | 全部角色（使用者仅自己相关） |
| stk:transfer / stk:check / stk:other | 调拨/盘点/其他出入库 | 仓管员 |
| req:apply | 领用申请 | 使用者 |
| req:audit | 领用审计 | 仓管员 |
| ocr:use / ocr:manage | 拍照识别/识别记录管理 | 仓管员 |
| report:view / report:export | 报表查看/导出 | 管理者/超级管理员 |
| sys:user / sys:role / sys:log / sys:config / sys:backup | 系统管理 | 超级管理员 |

## 11. 关键实现要点

1. **库存事务**：所有过账接口统一走 `post_stock_change()`：`SELECT ... FOR UPDATE` 锁 stk_stock 行 → 校验充足 → 写 stk_stock_log → 更新 stk_stock → 更新单据状态，单事务提交，防并发超领/超卖（SQLAlchemy + 行锁）。
2. **OCR 引擎抽象**：定义统一接口 `OCRClient.recognize(图片) -> [{text, box, score}]`，两个实现：
   - `RapidOCREngine`：Windows 部署，复用 `app/services/ocr/rapidocr_api.py`（OcrAPI 子进程常驻，线程池排队）；
   - `PaddleOCREngine`：Debian/Linux 部署，paddleocr Python 包（paddlepaddle CPU 推理，中文模型 ch_PP-OCRv4），Python 3.11 兼容；
   引擎选择存 sys_config（ocr.engine = rapidocr/paddle），启动时按配置加载；`GET /health` 返回当前引擎类型与状态；切换引擎只影响识别层，结构化/匹配/大模型链路不变；引擎初始化失败返回可读错误（5001）并降级为纯人工录入。
3. **大模型**：统一 `LLMClient` 抽象（doubao 视觉 / deepseek 文本两个实现），Key/BaseURL 存 sys_config；调用失败不影响主流程，走人工兜底；AI 建议一律人工确认后才新增商品。
4. **异步任务**：OCR/大模型用 FastAPI BackgroundTasks + 内存任务表；完成后写 sys_notification 通知相关用户。
5. **外网安全**：正式 HTTPS 证书；Session Cookie HttpOnly+Secure+SameSite=Lax；登录失败 5 次/10 分钟锁定；操作日志留存。
6. **定时任务**：APScheduler —— 库存预警扫描（每分钟）、每日凌晨自动备份（mysqldump → sys_backup_log）、会话过期清理。
7. **Excel**：openpyxl 导入导出（商品/供应商/期初/报表），导入返回逐行错误信息。
8. **错误码**：4001 库存不足 / 4002 单据状态不允许 / 4003 商品或库位不存在 / 4004 登录失败或已锁定 / 4005 无权限 / 4006 参数校验失败 / 5001 OCR 引擎未初始化 / 5002 大模型调用失败 / 5003 文件处理失败。
9. **性能**：单据保存走单事务 + 索引（UK product×warehouse×location），百人并发无压力；OCR/大模型异步，不阻塞开单。
