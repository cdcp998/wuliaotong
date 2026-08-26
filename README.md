# 物料通管理系统

企业内部物料仓库管理系统：**入库、出库、领用（维修使用）**，支持电脑端 / 手机端，拍照 + OCR + 大模型 AI 辅助录入。

## 功能总览

### 基础资料
- 材料（商品）管理：编码纯数字自动生成、物料编码（公司系统编码）、条码、型号规格、分类、单位、进价、库存上下限、多供应商关联
- 分类 / 计量单位（国标 51 项）/ 供应商（自动编码）/ 仓库 / 货架 / 库位（自动编码、2D 分层货架图、按单位过滤）
- Excel 导入导出（兼容公司 13 列表头模板：物料编码/材料名称/型号规格/两级分类自动创建）

### 库存
- 采购入库（含作废冲销、移动加权成本、历史采购价、供应商/日期/备注表头）
- 期初库存（草稿/过账/Excel 导入）、库存查询 / 流水、库存预警（定时任务 + 站内通知，规则生成含消耗/采购价的正文）
- 调拨、盘点（物品级 + 拍照留痕 + 当场新增账外物料 + 收发存 21 列导出）、其他出入库
- **统一库存事务**：一切变动走 `post_stock_change()`（行锁 + 单事务，防超领/超卖）

### 领用（三步合一）
- 手机端申请（材料/地点/原因统一提交）→ **提交即自动出库**（库存不足先负数并通知管理员）→ 完成工作拍照（GPS 定位 + 动态水印）→ 仓管员审计（驳回/取消自动回补）
- **管理员代取消与删除**：申请人无法操作的卡单可由管理员代为取消（自动通知申请人、回补库存）；已取消单据可整单删除清理，出入库流水保留追溯
- 私用隐藏触发（连点 15 次锁定私用，非管理员仅见掩护值）、GPS 逆地理编码（OpenStreetMap）、仓管员代申请、审核辅助摘要（规则风险等级 + 原因）

### 站内消息（双端统一）
- 电脑端顶栏铃铛抽屉 / 手机端「消息」页共用同一套展示逻辑（`packages/shared` 单一事实源）：**类型筛选胶囊**（全部 / 未读 n / 预警 / 待办 / 提醒）、左侧类型图标块、未读蓝点、相对时间、今天/昨天/更早分组
- 管理模式：方形勾选 + 全选 / 清空全部 / 删除选中；点击业务通知自动标记已读并联动跳转对应单据；未读角标 30s 轮询

### OCR / 大模型（AI 赋能）
- 本地 OCR：PaddleOCR（默认，可自动安装）/ RapidOCR-json 可切换（`services/ocr` 已抽象统一基类）；OCR 文本经 **文本模型纠错归一**后入匹配链路
- 送货单识别入库：多模态大模型结构化（名称/物料编码/规格/单位/数量/单价/金额）+ 文本模型材料分类 → 人工确认 → 供应商落库（**本地别名归一**）→ 物料自动匹配/新增 → 带入入库
- 商品拍照识别：本地 OCR → 本地模板匹配 → 视觉模型结构化（品牌/名称/规格）→ 未匹配 AI 分析建议；**模板自动学习**（同一商品识别命中 3 次自动生成模板）
- 材料分类自动识别、材料查重（本地相似规则分组 + 人工标记）、供应商名称归一 + 人工合并、领用审核辅助摘要、预警 AI 通知、报表 AI 月报摘要
- **大模型调用日志**全量记录输入/输出/耗时/成败（系统管理「AI 调用日志」页可查）
- **兼容性标准**：遵循 **OpenAI Chat Completions 兼容协议**，视觉/文本/兜底三个模型槽位的 Base URL、API Key、模型名均可自由配置——支持 SiliconFlow、DeepSeek、火山方舟、通义、智谱等任意 OpenAI 兼容云服务商，也支持自建内网服务（vLLM / Ollama 等），不绑定特定供应商
- **配额与预警**：配额获取与告警依赖服务商官方余额接口（仅 SiliconFlow / DeepSeek / 火山方舟提供）；其他兼容服务商可正常识别但无法获取配额（界面明确提示），阈值/收件人/获取间隔均可配置，低于阈值自动发邮件

### 报表与导出
- 经营看板（今日/本周/本月出入库、预警、待办、7 日趋势）、进销存汇总（期初+入-出=结存）、库存报表（周转/呆滞）、2D 货架图、盘点收发存导出
- **统一导出服务**：xlsx/csv 三级格式合并（内置 < 模块级 < 请求级）、冻结/筛选/打印标题、导出文件名自动追加时间戳防重名

### 认证与系统管理
- Session 登录（连续失败 3 次需验证码）、修改密码（踢其他会话）、忘记密码（SMTP 邮箱发码/联系管理员电话）、注册三模式（开放/审核/关闭）
- 用户/角色权限（24 权限点、按单位过滤货架）、注册审核、单位管理、操作日志（字段级中文元数据 + 详情抽屉 + 导出）、系统设置、数据库备份（手动 + 每日 02:00 自动，保留 14 份）
- 入口：电脑端 `/`、手机端 `/m/`；用户手动选择优先于设备检测；已登录直进主页

## 演示界面

> 以下为开发环境实拍截图（存放于 `docs/images/`），实际效果以部署版本为准。

### 经营看板

![经营看板](docs/images/dashboard.png)

登录后直达的经营主页：今日/本周/本月出入库汇总、库存预警与待办、近 7 日出入库趋势，以及入库 / 出库 / 领用等常用功能快捷入口。

### GIS 线缆地图工作台

![GIS 线缆地图](docs/images/gis-map.png)

Leaflet 地图全工作区：线缆绘制/故障定位、测距画线、图层开关、断点续传的地图缓存管理，移动端支持定位飞行与导航。

### 仓库与货架

![仓库与货架](docs/images/warehouses.png)

库存与仓库管理工作台：分层货架图、调拨 / 盘点 / 其他出入库、历史价格与库存预警规则配置。

### 领用申请

![领用申请](docs/images/requisition-apply.png)

材料 / 地点 / 原因三步合一领用申请，提交即自动出库；完成工作拍照（GPS 定位 + 动态水印）后进入仓管员审计闭环。

### 消息中心（电脑端抽屉）

![消息中心](docs/images/messages-desktop.png)

### 手机端消息页

![手机端消息页](docs/images/messages-mobile.png)

双端同一套交互语言：筛选胶囊、类型图标块、日期分组、管理模式批量处理。

## 技术栈

- 前端：React 19 + TypeScript + Vite + Zustand + Ant Design（电脑端）/ Ant Design Mobile（手机端），npm workspaces monorepo（`apps/desktop` / `apps/mobile` / `packages/shared` 共享包）
- 后端：Python 3.13 + FastAPI + SQLAlchemy 2.x + MySQL 8.0 + Redis（缓存加速层，可降级）+ APScheduler
- OCR：PaddleOCR（默认）/ RapidOCR-json（可切换，统一 `OCRClient` 抽象）
- 大模型：视觉（送货单/商品识别）、文本（纠错/分类/摘要/查重/别名）、兜底槽位，任意 OpenAI 兼容服务商

## 目录结构

```
├─ backend/                # FastAPI 后端
│  ├─ app/{api,core,models,schemas,services}
│  ├─ sql/init.sql         # 全量建表 + 种子数据（幂等）
│  ├─ tests/               # pytest 接口测试
│  └─ data/{files,backups}
├─ frontend/               # npm workspaces
│  ├─ apps/desktop         # 电脑端（Antd）
│  ├─ apps/mobile          # 手机端（Antd Mobile）
│  └─ packages/shared      # api client / 类型 / 通知展示逻辑 / 工具
├─ docs/images/            # README 特色截图
├─ scripts/                # 测试分层/视觉核验/质量基线等工具脚本
├─ testdata/               # 真实样本（送货单/物品标签/模板表格/条码）
└─ AI开发文档/              # 开发基线文档（见下表）
```

> 说明：OpenPencil 设计源稿、界面截图、设计基准比对产物、会话交接记录为**本地开发资产，不入版本库**（见 `.gitignore`）。

## 设计文档（AI开发文档/，开发基线，修改须同步代码）

| 文档 | 说明 |
|---|---|
| 开发规范.md | **开发强制流程**（Git/目录/代码/验证门禁 L1-L5） |
| 数据库设计.md | 表结构与设计决策 |
| 操作日志详情展示方案.md | 操作日志字段元数据与详情展示设计 |
| 线缆和设备插件开发方案.md | 线缆 / 设备模块插件化设计 |
| UI设计交付文档.md | OpenPencil 设计 Token 与界面文字规格 |
| 代码质量基线.md | 前后端质量基线工具口径与复现方式 |
| 开发进度记录.md | 阶段完成/验证/遗留（与 git 提交一一对应） |
| 历史文档/ | 归档：需求大纲、后端API设计、前端设计、UI设计方案、AI赋能设计等 |

## 开发流程（严格遵循《开发规范.md》）

1. **设计先行**：改需求/接口/数据库文档 → 评审 → 再写代码；代码与设计不一致视为缺陷
2. **小步提交**：每功能一个提交，格式 `类型(范围): 描述`（feat/fix/docs/refactor/test/chore）
3. **验证门禁**（提交前必须）：
   - L1 语法/类型：`python -m compileall app`；`npm run typecheck`（零错误）
   - L2 接口：`scripts/run_tests.sh`——普通改动自动跑**针对性测试**（按 git diff 映射）；发布/关键变更用 `scripts/run_tests.sh --full` 跑全量
     - 测试库隔离：设置 `TEST_DB_URL`（如 `mysql+pymysql://root:***@127.0.0.1:3306/wuliaotong_test`）后运行 pytest，可避免测试直连开发库；Python 依赖可复现安装：`pip install -r backend/requirements.lock`
   - L4 前端：`npm run build -w wlt-desktop`、`npm run build -w wlt-mobile`（发布/关键变更时）
   - 测试/构建失败**不允许提交**
4. **文档同步**：每项完成后回写《开发进度记录.md》（交付/验证/遗留/提交）；接口/表结构变更同步对应设计文档
5. **数据红线**：禁止物理删除业务数据（用状态位）；库存变动必须走 `post_stock_change()`；API Key 只存 sys_config 并脱敏；.env 不入库

## 本地开发环境

- Python 3.13、MySQL 8.0、Node 20、Redis 5.x（127.0.0.1:6379；缓存加速层，不可用时自动降级直查数据库）
- 端口：后端 **8443（HTTPS，自签名）**、电脑端 dev **5174**、手机端 dev **5175**
- 后端需配置大模型 Key（系统设置 → OCR 与大模型）：视觉 / 文本 / 兜底三槽位，任意 OpenAI 兼容服务商

## 快速启动

```bash
# 0. 启动 Redis（缓存层；本机已装为 Windows 服务 RedisWLT 可跳过）
redis-server.exe redis.conf   # 或 sc start RedisWLT

# 1. 生成开发者证书（本地 CA + 服务器证书，SAN 含 localhost/127.0.0.1/LAN IP；已生成则跳过）
# Git bash 下需先 export MSYS_NO_PATHCONV=1（否则 /CN= 被转成 Windows 路径）
cd backend && mkdir -p certs/dev && cd certs/dev
export MSYS_NO_PATHCONV=1
openssl genrsa -out ca-key.pem 2048
openssl req -x509 -new -key ca-key.pem -days 3650 -subj "/CN=Wuliaotong Dev CA" -out ca.pem \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl genrsa -out key.pem 2048
openssl req -new -key key.pem -subj "/CN=<LAN_IP>" -out dev.csr
printf '[v3_req]\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:<LAN_IP>\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n' > dev-ext.cnf
openssl x509 -req -in dev.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 825 \
  -out cert.pem -extfile dev-ext.cnf -extensions v3_req && rm dev.csr dev-ext.cnf ca.srl
# 本机信任 CA（当前用户级，免管理员）：certutil -user -addstore -f Root ca.pem
# 内网其他设备访问 https://<LAN_IP>:8443|5174|5175 时，需把 ca.pem 装到该设备受信任根
# 更换证书后必须重启后端与两端 vite（证书在启动时加载，热替换不生效）

# 2. 后端（HTTPS，端口 8443）
cd backend
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env   # 按需改 DB_URL 等
# 数据库可手动预建（可选）：安装页会自动建库+导入表结构，无需手工执行
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS wuliaotong DEFAULT CHARACTER SET utf8mb4;"
mysql -uroot -p wuliaotong < sql/init.sql   # 全量建表+种子（幂等）
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8443 \
  --ssl-keyfile certs/dev/key.pem --ssl-certfile certs/dev/cert.pem

# 3. 接口测试（L2 门禁，分层执行）
scripts/run_tests.sh              # 普通改动：按 git diff 自动跑针对性测试
scripts/run_tests.sh --full       # 发布/主干/关键变更：后端全量 + 前端 typecheck + build
scripts/run_tests.sh --dry-run    # 预览本次将执行的测试范围

# 4. 前端（dev，端口 5174/5175）
cd frontend && npm install
npm run dev:desktop   # 电脑端
npm run dev:mobile    # 手机端

# 5. 浏览器访问（首次需信任 ca.pem）
# 本机：电脑端 https://localhost:5174  手机端 https://localhost:5175
# 内网设备：https://<内网IP>:5174（电脑端）/ https://<内网IP>:5175（手机端）
```

## Docker 部署（跨平台，推荐生产/演示）

一条命令拉起全部服务（MySQL 8 + Redis 7 + 后端 FastAPI + 前端 Nginx，前端同时托管电脑端 `/` 与手机端 `/m/`）：

```bash
docker compose up -d --build
# 打开 http://localhost:8080（端口可用环境变量 WEB_PORT 改）
```

**首次初始化**：打开页面后会自动进入「初始化向导」——数据库/Redis 连接信息已由编排预填（`mysql`/`redis` 服务名），只需设置**管理员账号与密码**并提交；`backend/sql/init.sql` 已在 MySQL 首次启动时自动导入（表结构 + 种子数据），无需手工建库。

**常用操作**：

```bash
docker compose logs -f backend     # 查看后端日志
docker compose down                # 停止（保留数据卷）
docker compose down -v             # 停止并删除数据卷（清空数据库/上传，重新初始化）
```

**环境变量**（`.env` 或 `docker compose run -e`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` | `root` | MySQL root 密码（首次初始化用，勿用于生产） |
| `WEB_PORT` | `8080` | 前端映射端口 |

**数据持久化**：`mysql_data`（数据库）、`uploads`（后端 `/app/data`：上传照片/备份/初始化标记）。

**注意事项**：
- 后端镜像含 PaddleOCR，**首次 OCR 识别自动下载模型（需外网）**；离线环境可把模型目录挂载到容器 `/root/.paddlex` 复用
- 前端走 Nginx 同源反代 `/api/` → 后端 `:8000`，无需跨域；大文件上传限制 20MB（nginx.conf 可调）
- 会话 Cookie 非 HTTPS（`COOKIE_SECURE=false`）；生产建议前置 HTTPS 网关（如 Caddy/Traefik）并置 `COOKIE_SECURE=true`

## 生产部署（Windows + Nginx + HTTPS）

1. **数据库**：MySQL 8.0 建库 `wuliaotong`（utf8mb4），导入 `backend/sql/init.sql`（幂等，可重复执行）
2. **后端**：
   - 安装 Python 3.13 + `pip install -r requirements.txt`；配置 `backend/.env`（DB_URL、SESSION_COOKIE_NAME、BACKUP_MYSQLDUMP 指向 mysqldump 绝对路径、BACKUP_DIR、REDIS_URL）
   - 启动 Redis 并保持运行（缓存加速层；Redis 挂掉时自动降级，业务不受影响）
   - 启动：`uvicorn app.main:app --host 127.0.0.1 --port 8080 --proxy-headers --forwarded-allow-ips=127.0.0.1`（内网端口，由 Nginx 反代；生产 HTTPS 由 Nginx 终止；`--proxy-headers` 让限流/审计拿到真实客户端 IP）
   - 建议用 NSSM/任务计划注册为 Windows 服务（开机自启、崩溃重启）
3. **前端**：`cd frontend && npm ci && npm run build`（产出 desktop/mobile dist）
4. **Nginx**（示例）：

```nginx
server {
    listen 443 ssl;
    server_name 你的域名;
    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;

    # 电脑端（desktop dist 根路径）
    location / { root /path/desktop/dist; try_files $uri /index.html; }
    # 手机端（mobile dist，vite base=/m/ + 路由 basename=/m/）
    location /m/ { alias /path/mobile/dist/; try_files $uri /m/index.html; }
    # API 反代
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
server { listen 80; server_name 你的域名; return 301 https://$host$request_uri; }
```

5. **大模型配置**：登录后进入 系统设置 → OCR 与大模型，填入 视觉 与 文本 API Key，保存后「获取模型列表」选择模型
6. **验证**：`GET https://域名/api/v1/health` 返回 ok；登录联调；`AI 调用日志`页确认大模型链路正常
7. **备份**：每日 02:00 自动 mysqldump → gzip（保留 14 份）；也可系统管理手动备份/下载

## 默认账号

- 管理员：`admin`（密码由**初始化安装向导**设置；`init.sql` 中仅插入不可登录的占位哈希，直接导入脚本后必须先跑安装向导或手动 `UPDATE` bcrypt 哈希）
- 测试用户：`tester_user` / `123456`（仅测试环境；pytest 未设置 `TEST_DB_URL` 时会自动补齐该账号与 `admin/admin123` 测试口令）

## 测试样本（testdata）

按用途分目录存放真实样本（详见归档文档《AI赋能设计.md》样本数据章节）：
`进货单/`（送货单识别基准）、`物品标签/`（商品识别与模板训练）、`匹配导出表格/`与`匹配导入表格/`（收发存模板对照）、`手写出货单/`（手写评估样本位，待补充）、`条码测试/`（条码解码样本：EAN13/Code128/QR、无条码对照、小条码/模糊条码模拟实拍，均可被服务端 zxing-cpp 解码）

## AI 代码生成提示（供 AI 编程助手参考）

使用 AI 编程助手（Claude Code / Cursor / Copilot 等）在本仓库生成或修改代码前，请先阅读以下约定，避免破坏项目不变量。

**架构基线**
- 前后端分离：`frontend/`（React 19 + TypeScript + Vite + Zustand + Ant Design，npm workspaces monorepo：`apps/desktop` 电脑端 / `apps/mobile` 手机端 / `packages/shared` 共享包）、`backend/`（Python 3.13 + FastAPI + SQLAlchemy 2.x + MySQL 8.0）
- 设计文档是开发基线（`AI开发文档/` 下《开发规范.md》《数据库设计.md》等）：**代码改动须同步文档，反之亦然**
- `packages/shared` 为前后端共享包（api client / 类型 / 通知展示逻辑等），dev 走 HMR 无需重启；vite `server.https` 依赖 `backend/certs/dev` 证书（缺失时自动跳过 https，CI 纯构建可过）

**必须遵守的不变量（勿改坏）**
- 库存一切变动走 `backend/app/services/stock.py::post_stock_change()`（行锁 + 单事务），禁止绕过
- 大模型调用遵循 **OpenAI Chat Completions 兼容协议**，视觉/文本/兜底三槽位可在系统设置自由配置，不绑定特定供应商
- 版本单一事实源：`backend/app/__init__.py::__version__`；`scripts/check_version.py` 强制前后端版本一致，漂移禁止提交
- Redis 是加速层、MySQL 是事实来源：缓存操作失败必须静默降级直查库（`app/core/cache.py`；改函数内用到的模块级变量时 `global` 声明必须齐全）
- 事件循环异常过滤器 / Proactor accept 加固（`app/core/loop_guard.py`）：判定错误码用 `getattr(exc, "winerror", None)` 跨平台兜底，勿改回裸 `exc.winerror`（Linux 无该属性）
- 认证：Session 登录 + 权限校验中间件；操作日志由审计中间件记录；数据库会话按请求管理
- GitHub Actions（`.github/workflows/ci.yml`）：MySQL 8.0 服务容器**仅支持 Linux runner**；测试分层执行见 `scripts/run_tests.sh`

**常用命令**
- 分层测试：`scripts/run_tests.sh --changed="<文件...>"`（针对性）/ `--full`（全量）/ `--dry-run`（仅预览将执行的命令）
- 后端测试：`cd backend && python -m pytest tests -q`
- 前端：`cd frontend && npm run typecheck`，构建：`npm run build -w wlt-desktop && npm run build -w wlt-mobile`
- 版本一致性校验：`python scripts/check_version.py`
