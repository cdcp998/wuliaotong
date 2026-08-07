# 物料通管理系统 —— 后端 API 设计

> FastAPI + Python 3.13 + MySQL；依据《需求大纲.md》《数据库设计.md》（2026-03-31 确认版）

## 0. 总体约定

- 路径前缀：`/api/v1`；请求/响应均为 JSON（文件上传除外）
- 统一响应体：`{"code": 0, "message": "ok", "data": ...}`；`code != 0` 为业务错误
- 分页：`?page=1&page_size=20`，data 返回 `{list, total, page, page_size}`
- 认证：Session Cookie（HttpOnly + Secure），登录接口下发；除登录外所有接口校验会话（公开例外：/health、/init/status、/init 及 /auth 下公开接口）
- 权限：依赖注入 `require_permission("权限code")`，权限点清单见第 10 节
- 审计：所有写操作（POST/PUT/DELETE）由中间件自动记录 `sys_operation_log`
- 金额/数量：接口传输字符串（如 "12.50"），避免浮点精度问题；服务端 Decimal 计算
- 时间：`YYYY-MM-DD HH:mm:ss`；单据日期默认当天
- 图片上传：multipart，单张 ≤10MB，服务端 Pillow 压缩（WebP q80，长边≤1600px），永久保存

## 1. 认证与用户管理

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | /auth/login | {username, password, captcha_id?, captcha_code?, remember?} → 写 session，返回用户信息；连续失败 3 次（10 分钟窗口）后必须带验证码（错误码 4007）；**remember=true（勾选「记住登录状态」）时会话时长用 `SESSION_REMEMBER_HOURS`（默认 720 小时=30 天），否则用 `SESSION_EXPIRE_HOURS`（默认 8 小时）**，DB expire_at / Redis TTL / Cookie max-age 三处一致 | 公开 |
| GET | /auth/captcha | 4 位数字+字母验证码图片（base64）→ {captcha_id, image} | 公开 |
| POST | /auth/logout | 注销会话 | 登录 |
| GET | /auth/me | 当前用户 + 角色 + 权限点列表 | 登录 |
| PUT | /auth/password | 修改自己密码 {old_password, new_password}（改密后其他会话失效） | 登录 |
| POST | /auth/forgot | 找回密码 {username, email?}；按系统配置 auth.forgot_method（email 发 6 位重置码 / phone 返回管理员电话 / both 优先邮箱） | 公开 |
| POST | /auth/forgot/reset | {username, code, new_password} 用重置码重置密码 | 公开 |
| POST | /auth/register | 注册 {username, password, real_name?, phone?, email?}；按 auth.register_mode：open 直接建使用者账号 / closed 拒绝 / review 进审核队列 | 公开 |
| GET | /auth/register/status | 注册模式与联系电话（前端控制注册入口显示） | 公开 |
| GET | /users?keyword=&status=&role_id=&page= | 用户列表（含 email） | sys:user |
| POST | /users | 新增用户（含 role_id、初始密码、email） | sys:user |
| PUT | /users/{id} | 修改用户（姓名/电话/邮箱/角色/状态/重置密码；内置 admin 不可停用、不可改自己的角色与状态） | sys:user |
| DELETE | /users/{id} | 停用账号（逻辑停用，保留历史数据） | sys:user |
| GET | /register-applies?status=&page= | 注册申请列表（审核注册模式） | sys:user |
| POST | /register-applies/{id}/approve / reject | 审核注册申请（通过后创建使用者账号） | sys:user |
| GET | /roles | 角色列表（含 department_id/department_name 所属单位） | sys:role |
| POST / PUT / DELETE | /roles, /roles/{id} | 角色维护（code/name/description/department_id；内置角色禁删、super_admin 权限锁、有启用用户引用禁删） | sys:role |
| PUT | /roles/{id}/permissions | 保存角色权限点 {permission_ids: []}（super_admin 角色不可改） | sys:role |
| GET | /permissions | 权限点列表 | sys:role |

登录示例：
```
POST /api/v1/auth/login
{"username": "zhangsan", "password": "******", "remember": true}
→ 200 {"code": 0, "data": {"user": {"id": 1, "username": "zhangsan", "real_name": "张三",
     "role": {"id": 3, "code": "storekeeper", "name": "仓管员"},
     "permissions": ["stk:query", "pch:in", ...]}}}
（remember 省略/为 false 时 Set-Cookie max-age=8h；为 true 时 max-age=720h）
```

## 1.1 系统初始化安装（首次启动引导）

系统以**文件系统标记文件 `backend/data/.initialized`（路径可用环境变量 `INIT_MARK_FILE` 覆盖）是否存在**判断是否已完成初始化安装——**不依赖数据库状态**（数据库重建/备份恢复不会强制重新进入初始化流程）；**未初始化时前端（电脑端入口/登录页/受保护路由，手机端登录页）强制跳转 `/init` 初始化安装页**，完成后自动登录进入主页面。

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | /init/status | 初始化状态 → `{initialized: bool, site_name: string}`；initialized 仅由标记文件存在性判断（不触发任何初始化状态数据库查询），site_name 读 sys_config | 公开 |
| POST | /init | 执行初始化 `{site_name, admin_username, admin_password, contact_phone?, db_host, db_port, db_user, db_password, db_name, redis_host, redis_port, redis_password, redis_db}`：**提交时自动验证数据库连接（pymysql 试连，失败 4006 阻止安装；目标库不存在（MySQL 1049）时自动建库 utf8mb4 并导入 `backend/sql/init.sql` 建表+种子，目标库存在但为空时同样自动导入，已有表的库只验证连接、不动表结构；常见错误码映射中文提示：1045 账号/密码错误、1044 无权限、2003/2002 无法连接服务器）与 Redis 连接（失败不阻止，响应带 redis_connected 提示降级）**；写 site.name/site.contact_phone，重置或创建内置超管账号（admin_username 与现有超管账号不同则改名，冲突报 4006）；数据库/Redis 配置写入 `backend/.env`（`DB_URL`/`REDIS_URL`，URL 编码密码，重启后端后生效，.env 已 gitignore 不入库）；事务提交成功后**原子写入标记文件**（临时文件 + os.replace，内容含完成时间，目录权限不足报 5003）；**仅未初始化时可执行，重复执行报 4006** | 公开 |

- 校验：site_name 1-50 字符；admin_username 2-50 位（字母/数字/下划线/中划线）；admin_password ≥6 位（与注册规则一致）；db_user/db_name 必填（1-100 字符；**db_name 限字母/数字/下划线 `^[A-Za-z0-9_]+$`，防标识符注入，建库时反引号转义双保险**）；db_port/redis_port 1-65535；redis_db 0-15
- 配置项默认值：db_host=`127.0.0.1`、db_port=`3306`、redis_host=`127.0.0.1`、redis_port=`6379`、redis_db=`0`、redis_password 空=无密码；**密码不回显**（接口不返回已保存配置）；db_password **接口层允许空串**（兼容无密码本地 MySQL，安装页前端必填）
- 连接验证：DB 必须通过（含库名——**目标库不存在或为空时自动建库/导入 init.sql，无需手工建库；已有表的库仅验证连接，不自动导入表结构，避免破坏已有部署数据**）；Redis 失败仅提示（缓存层已设计优雅降级直查数据库，不阻塞业务）
- 启动容错：**后端启动时的数据库自检失败仅告警不阻止启动**（数据库未就绪/未安装时仍可启动并进入安装页）；`GET /init/status` 在数据库不可用时返回 `site_name: ""` 不报错（initialized 仅由标记文件判断）；安装完成后数据库不可用即由业务接口/`/health`（`db: "down"`）如实暴露故障
- 安全：接口只在未初始化时可用（防重入）；标记文件存在即拒绝再次初始化——**与数据库内容无关**（删库/重建库/备份恢复均不会重新进入初始化页）；写操作照常进审计日志（user_id=0）
- 可靠性：标记文件在业务事务 commit 成功之后才写入 → **标记文件存在 ⇔ 初始化数据已落库**；写入失败返回 5003 且不谎报成功，可重试
- 迁移：init.sql 不再含 sys.initialized 配置（该行已移除）；**已有部署库无需任何数据库操作**——删除标记文件即可重新进入初始化页（保留业务数据，仅重置超管密码与站点信息）；`backend/data/` 已 gitignore，标记文件不入库

## 2. 基础资料

**商品**
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /products?keyword=&category_id=&barcode=&status=&page= | 列表（keyword 匹配名称/编码/物料编码/SKU/条码） |
| POST | /products | 新增 {code?, material_code?, barcode, sku, name, supplier_ids?, ...}；**code 纯数字**（留空自动生成 = 当前最大数字编码+1）；material_code=物料编码（公司系统编码，可空，空则提示管理员补录）；supplier_ids=关联供应商（多对多，编辑时缺省保持/[]清空）；条码非空全局唯一 |
| GET / PUT | /products/{id} | 详情（含 supplier_ids/supplier_names）/ 修改 |
| GET / PUT | /products/{id} | 详情 / 修改 |
| POST | /products/import | Excel 批量导入，返回 {success_count, fail_rows, notice}；公司模板：物料编码→material_code（唯一去重）、商品编码自动纯数字、条码留空，物料编码/条码为空响应 notice 提示管理员补录 |
| GET | /products/export?keyword= | Excel 导出 |

**分类 / 单位 / 供应商 / 仓库 / 货架 / 库位**（CRUD 同构，不再展开）
- GET /categories（树）、POST /categories、PUT/DELETE /categories/{id}
- GET /units、POST /units
- GET/POST /suppliers、PUT/DELETE /suppliers/{id}、POST /suppliers/import
- GET/POST /warehouses、PUT/DELETE /warehouses/{id}
- GET /warehouses/{id}/shelves（**非超管/管理者角色按所属单位过滤**：仅见本单位 base_department_shelf 关联货架）、POST /shelves、PUT/DELETE /shelves/{id}
- GET /locations?warehouse_id=&shelf_id=（2D 货架图数据源）、POST /locations {warehouse_id, shelf_id, layer_no}、PUT/DELETE /locations/{id}
- GET /stock/location-summary?warehouse_id=&shelf_id=（2D 货架图：库位商品库存+预警绿/红/黄，一次返回避免 N+1）

**组织单位（部门）**（dept:manage）
- GET /departments（登录即可）、POST /departments、PUT/DELETE /departments/{id}（有角色引用禁删）
- PUT /departments/{id}/shelves {shelf_ids: []} → 设置单位可用显示的货架；角色 department_id 关联后，该角色用户（非超管/管理者）货架/货架图按单位过滤

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
  body: `{warehouse_id, use_location(必填), use_reason(必填), location_photo_file_id?, remark, items: [{product_id, qty, location_id, photo_file_id}]}`
  → **提交即自动出库**（同一事务 post_stock_change，`allow_negative=True` 允许负库存——实物与系统账可能不符）；库存为负时站内通知管理员（超管/管理者/仓管员）；返回 {bill_no, shortages:[...]}；出库商品照片/使用地点照片不强制
- GET /requisitions/my?status=&page= 我的申请（使用者）
- GET /requisitions?status=1&keyword=&page= 待审计列表（仓管员）
- GET /requisitions/{id} 详情（含明细+照片+审计记录）
- PUT /requisitions/{id} 修改（仅"已驳回"状态可改后重新提交）
- POST /requisitions/{id}/cancel 取消（仅"待审计"状态）
- POST /requisitions/{id}/audit {action: "approve"|"reject", remark}
  - approve：库存已在提交时自动扣减，审计通过仅确认状态 → 通知申请人
  - reject：状态=已驳回 + **自动回补库存**（领用驳回回补流水）→ 通知申请人
- 取消（POST /requisitions/{id}/cancel）：**自动回补库存**（领用取消回补流水）；驳回后修改重提（PUT）会再次自动出库

## 5. 调拨 / 盘点 / 其他出入库

- POST /transfers {from_warehouse_id, to_warehouse_id, items:[{product_id, qty, from_location_id, to_location_id}]} → 草稿
- POST /transfers/{id}/audit → 审核过账（同事务：调出仓扣、调入仓加、两条流水）
- GET /transfers、GET /transfers/{id}、POST /transfers/{id}/void
- POST /checks {warehouse_id} → 创建盘点单，自动带出账面明细（book_qty）
- PUT /checks/{id}/items {items:[{check_item_id, real_qty, photo_file_id?}]} 录入实盘（**拍照记录可选**）
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
| POST | /files/upload | multipart(file, biz_type?, biz_id?) → {file_id, url}；按 sys_storage 策略选存储落盘（fill/round/manual），Pillow 压缩（WebP q80，长边≤1600px），永久保存 |
| GET | /files/{file_id} | 流式读取文件（登录即可，业务图片展示用） |
| GET | /storages | 存储位置列表（后台管理） |
| POST | /storages | 新增存储位置 {name, type=local, path, policy, is_default, remark} |
| PUT | /storages/{id} | 修改存储位置（sys:config） |
| DELETE | /storages/{id} | 停用（有文件的存储禁止删除） |
| GET | /storages/health | 各存储空间检测：路径存在/可写/总空间/剩余空间（sys:config） |
| POST | /ocr/recognize | {file_id, ocr_type: 1送货单/2商品外包装/3标签型号, mode: auto/template/llm} → {task_id}；送货单（ocr_type=1）四级回退链（mode=auto）：① 本地 OCR + 规则模板（已知格式，秒级，engine=template）→ ② 通用字段提取 generic_parser（未知格式，坐标列识别，毫秒级，engine=generic）→ ③ SiliconFlow 视觉结构化（engine=siliconflow+deepseek）→ ④ DeepSeek 文本结构化（engine=deepseek）；各级结果统一过容错校验 sanitize_items，全部失败返回 {lines} 人工录入；mode=template 仅本地①+②，mode=llm 仅③+④ |
| GET | /ocr/tasks/{task_id} | {status: running/done/failed, structured, record_id} 轮询 |
| POST | /ocr/quick | {file_id, ocr_type: 2/3} 同步快查，识别链路按序执行（每级失败/未命中进入下一级）：① 条码解码（zxing-cpp，条码命中商品库直接返回）→ ② 本地 OCR + 纠错 + 模板匹配 → ③ 视觉模型识别物品（SiliconFlow → 豆包兜底链）→ ④ 未识别出物品则视觉纯文本提取 + 文本匹配，仍无匹配则 DeepSeek 文本分析物品名称再匹配 → ⑤ 全部不可用返回 5001；返回 {lines, matches, record_id, barcode}（barcode 为空串表示未识别到条码）；权限 ocr:use |
| POST | /ocr/confirm | {record_id, structured} 人工修正确认（match_status=3） |
| POST | /ocr/match | {record_id} 未匹配商品 → 豆包视觉识别 → 生成 ai_suggestion → 站内通知 |
| GET | /ocr/records?date=&match_status=&page= | 识别历史 |
| POST | /ai-suggestions/{id}/accept | {name, spec, category_id, purchase_price...} 确认新增商品并回写 |
| POST | /ai-suggestions/{id}/ignore | 忽略建议 |
| POST | /barcode/decode | ?file_id= 上传的条码图片，zxing-cpp 解码返回 {barcode}（PIL 先解码图片；识别不到 4006；权限 ocr:use） |
| GET | /ocr/install-status | PP-OCR 自动安装状态（sys:config）：{status: idle/installing/done/failed, mode: cpu/gpu, log}；paddleocr 实际已安装时按真实环境检测返回 done + mode（paddle 是否启用 CUDA，检测结果缓存 60s） |
| POST | /ocr/install-paddle | 自动安装 paddlepaddle + paddleocr（sys:config，后台线程执行约 1-5 分钟，前端轮询 install-status；完成后需重启后端生效） |
| GET | /suppliers/{id}/products | 供应商关联材料列表（含停用材料，供供应商详情页） |

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

- GET /settings、PUT /settings（公司信息、单据编号规则、**图片池目录 image_pool.dir**、OCR 引擎参数、大模型 Key/BaseURL、**注册模式 auth.register_mode（open/closed/review）、找回方式 auth.forgot_method（email/phone/both）、管理员电话 site.contact_phone、SMTP smtp.host/port/user/password/from**、水印 watermark.template/position/bg_opaque、视觉模型 llm.siliconflow.enabled/api_key/base_url/model、PP-OCR 版本 ocr.model_version）
  - **值契约**：所有配置值统一字符串传输（开关用 "1"/"0"、数字用字符串如 "8"）；密钥字段（`*api_key`、`smtp.password`）GET 返回脱敏 `****后四位`，PUT 传掩码/空串表示不修改，传新值才覆盖；**传非字符串（number/null）返回 4006**（前端保存前统一转字符串）
- POST /llm/siliconflow/models、POST /llm/deepseek/models、POST /llm/doubao/models（sys:config）——用**已保存**的 API Key 调 OpenAI 兼容 `/models` 接口拉取模型列表 → `{models: [{id, owned_by}]}`；对应 enabled=0 → 4006（提示先启用并保存）、未配置 Key → 4006、网络/鉴权失败 → 5002（设置页「获取模型列表」按钮与保存后自动拉取共用）
- **大模型兼容性标准**：三个模型槽位（视觉 llm.siliconflow.* / 文本 llm.deepseek.* / 兜底 llm.doubao.*）统一遵循 **OpenAI Chat Completions 兼容协议**（`POST {Base URL}/chat/completions`，`Authorization: Bearer`，messages 数组格式）；Base URL / API Key / 模型名均可自由指定，支持任意 OpenAI 兼容服务商与自建内网服务（vLLM / Ollama / 第三方网关），不绑定特定供应商
- **配额与预警**（设置页「OCR 与大模型 → 配额与预警」，sys:config）：
  - POST /llm/quota/{provider}（provider ∈ siliconflow|deepseek|doubao）——立即获取配额/余额，结果存快照 `quota.snapshot`（JSON）；GET /llm/quota 读取快照；失败/不适用一律返回 `ok=false + error`（HTTP 200，优雅降级不抛错）
  - 前置跳过：模型未启用（llm.*.enabled=0）或未配置 API Key → 不查询，返回明确提示；Base URL 非官方域名（自建/第三方网关，无标准余额接口）→ 返回兼容性说明，不发起请求，不参与配额告警
  - 配额来源：SiliconFlow `GET /user/info`（totalBalance，元）、DeepSeek `GET /user/balance`（balance_infos[].total_balance，优先 CNY）、豆包 `GET /usage/quota`（quota_list[]，防御式解析 total/used/remaining_quota）
  - 配置键：`quota.warning.enabled`（1/0）、`quota.warning.recipients`（逗号分隔邮箱）、`quota.refresh.interval_minutes`（自动获取间隔分钟，默认 60；旧版 interval_hours 键自动 ×60 迁移）、`quota.warning.threshold.siliconflow/deepseek/doubao`（剩余低于该值时告警）；`quota.last_refresh` 记录最近获取时间（内部）
  - 定时任务每 5 分钟轻量触发，按 `quota.refresh.interval_minutes` 判断到点后：自动获取配额刷新快照（仅已启用且配置 Key 的服务商）→ 剩余低于阈值 → 邮件通知全部收件人（邮件服务见 §SMTP）；每服务商跌破阈值仅通知一次，恢复后清除标记可再次通知；手动获取（POST /llm/quota/{provider}）视为一次刷新并重置计时
- **运行时日志**：级别 DEBUG/INFO/WARN/ERROR（默认 INFO，环境变量 `LOG_LEVEL` 或系统设置 `log.level` 覆盖，保存后立即生效无需重启）；文件按天轮转 `logs/app-YYYY-MM-DD.log`；覆盖关键操作（请求/登录/OCR 任务/大模型调用/备份/设置修改），uvicorn 访问日志同文件
- 存储位置管理见 §7（/storages，多存储地址：fill 最空闲 / round 轮询 / manual 手动指定）
- GET /logs?username=&module=&method=&start=&end=&page= 操作日志（写操作审计查询）
- GET /notifications?is_read=&page=、PUT /notifications/{id}/read、PUT /notifications/read-all、GET /notifications/unread-count
- POST /backups（手动备份 mysqldump→gzip）、GET /backups、DELETE /backups/{id}、GET /backups/{id}/download（备份密码走 MYSQL_PWD 环境变量；每日 02:00 自动备份保留最近 14 份）
- GET /health（服务 + 数据库/Redis 状态 + LLM 服务商状态 + 当前 OCR 引擎类型与状态，部署/运维用；**数据库不可用时不报错——返回 `db: "down"`（安装完成前数据库未就绪属正常态，不阻塞启动与安装流程；安装完成后 db down 即视为故障）；**Redis 不可用时返回 `redis: "down"` 且不影响业务降级直查数据库；`llm` 返回 doubao/deepseek/siliconflow 三家的 `{enabled, configured, model}`——只读 sys_config（启用开关 + Key 是否已配置 + 模型名），不做在线探测以免探活消耗配额）

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
| dept:manage | 单位管理（单位 CRUD + 货架关联） | 超级管理员 |
| sys:llm-log | AI 调用日志（P9 大模型调用日志查询） | 超级管理员 |
| ai:suggestion | AI 建议处理（列表/忽略；确认新增仍要求 base:product） | 超级管理员/仓管员 |

## 11. 关键实现要点

1. **库存事务**：所有过账接口统一走 `post_stock_change()`：`SELECT ... FOR UPDATE` 锁 stk_stock 行 → 校验充足 → 写 stk_stock_log → 更新 stk_stock → 更新单据状态，单事务提交，防并发超领/超卖（SQLAlchemy + 行锁）。
2. **OCR 引擎抽象**：定义统一接口 `OCRClient.recognize(图片) -> [{text, box, score}]`，两个实现：
   - `RapidOCREngine`：Windows 本地兜底，复用 `app/services/ocr/rapidocr_api.py`（**非驻留**：每次识别启动一次 RapidOCR-json.exe 进程，stdin/stdout 管道收发指令，结果返回后进程即退出销毁，下次识别重新启动）；
   - `PaddleOCREngine`：**默认引擎**，paddleocr Python 包（paddlepaddle 固定 3.2.2，3.3.x Windows oneDNN PIR 执行器 bug；GPU 版用 scripts/install_*_gpu.py 安装），CPU/GPU 自适应；模型版本 PP-OCRv4/v5/v6 由 sys_config（ocr.model_version）配置；
   引擎选择存 sys_config（ocr.engine = paddle 默认 / rapidocr），启动时按配置加载；`GET /health` 返回当前引擎类型与状态；切换引擎只影响识别层，结构化/匹配/大模型链路不变；引擎初始化失败返回可读错误（5001）并降级为纯人工录入；**自动安装**：`POST /ocr/install-paddle` 后台 pip 安装 paddlepaddle+paddleocr，`GET /ocr/install-status` 返回 {status, mode: cpu/gpu, log}（设置页展示并轮询）。
3. **大模型**：统一 `LLMClient` 抽象（doubao 视觉 / deepseek 文本两个实现），Key/BaseURL 存 sys_config；调用失败不影响主流程，走人工兜底；AI 建议一律人工确认后才新增商品。
4. **异步任务**：OCR/大模型用 FastAPI BackgroundTasks + 内存任务表；完成后写 sys_notification 通知相关用户。
5. **外网安全**：正式 HTTPS 证书；Session Cookie HttpOnly+Secure+SameSite=Lax；登录连续失败 3 次/10 分钟要求 4 位数字+字母验证码（4007）；改密/重置后其他会话失效；操作日志留存。
6. **定时任务**：APScheduler —— 库存预警扫描（每分钟）、每日凌晨自动备份（mysqldump → sys_backup_log）、会话过期清理。
7. **Excel**：openpyxl 导入导出（商品/供应商/期初/报表），导入返回逐行错误信息。
8. **错误码**：4001 库存不足 / 4002 单据状态不允许 / 4003 商品或库位不存在 / 4004 登录失败或已锁定 / 4005 无权限 / 4006 参数校验失败 / 4007 需要验证码 / 5001 OCR 引擎未初始化 / 5002 大模型调用失败 / 5003 文件处理失败。
9. **性能**：单据保存走单事务 + 索引（UK product×warehouse×location），百人并发无压力；OCR/大模型异步，不阻塞开单。
10. **验证码/重置码内存态**（单进程部署）；报表全部基于 stk_stock_log 聚合可对账；数量输出统一去尾零（_fmt_qty）。
11. **Redis 缓存层**（2026-08-07）：统一走 `app/core/cache.py`（key 前缀 `wlt:`，cache-aside，`jsonable_encoder` 序列化；**Redis 不可用静默降级直查库**）。会话 `session:{token}`（TTL=会话时长，登录/登出/改密双写双删，未命中回源 `sys_session` 并回填）；权限 `role:{id}`/`role_perms:{id}`（5 分钟，admin 角色权限写操作失效）；字典 `dict:*` 与商品 `product:{id}`/`product:bc:*`（10 分钟，写时失效）；看板 `dash:*`/货架图 `stock:locsum:*`（60 秒，`post_stock_change()` 统一失效）；未读数 `notify:unread:{uid}`（30 秒，读通知/新通知失效）。
