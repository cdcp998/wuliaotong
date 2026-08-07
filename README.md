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
- 私用隐藏触发（连点 15 次锁定私用，非管理员仅见掩护值）、GPS 逆地理编码（OpenStreetMap）、仓管员代申请、审核辅助摘要（规则风险等级 + 原因）

### OCR / 大模型（AI 赋能）
- 本地 OCR：PaddleOCR（默认，可自动安装）/ RapidOCR-json 可切换；OCR 文本 **DeepSeek 纠错归一**后入匹配链路
- 送货单识别入库：视觉模型（SiliconFlow `nex-agi/Nex-N2-Pro`）结构化（名称/物料编码/规格/单位/数量/单价/金额）+ DeepSeek 材料分类 → 人工确认 → 供应商落库（**本地别名归一**：简称/全称互相包含或前缀一致）→ 物料自动匹配/新增 → 带入入库
- 商品拍照识别：本地 OCR → **本地模板匹配** → 视觉模型结构化（品牌/名称/规格）→ 未匹配 AI 分析建议；**模板自动学习**（同一商品识别命中 3 次自动生成模板）
- 材料分类自动识别（`/ocr/classify`，名称+规格 → 系统分类，入库明细「分类」列可编辑）
- 材料查重（本地相似规则分组 + 人工标记）、供应商名称归一（本地包含规则）+人工合并、领用审核辅助摘要（规则风险等级）、预警 AI 通知、报表 AI 月报摘要（P9）
- **大模型调用日志**（`sys_llm_log` 全量记录输入/输出/耗时/成败，系统管理「AI 调用日志」页可查）
- **兼容性标准**：大模型调用遵循 **OpenAI Chat Completions 兼容协议**（`POST {Base URL}/chat/completions` + Bearer 鉴权），视觉/文本/兜底三个模型槽位的 Base URL、API Key、模型名均可自由配置——支持 SiliconFlow、DeepSeek、火山方舟、通义、智谱等任意 OpenAI 兼容云服务商，也支持自建内网服务（vLLM / Ollama / 第三方网关等），不绑定特定供应商（系统设置 → OCR 与大模型）
- **配额与预警**：配额获取与告警依赖服务商官方余额接口（仅 SiliconFlow / DeepSeek / 火山方舟提供）；其他兼容服务商可正常识别但无法获取配额（界面明确提示，不参与告警），阈值/收件人/获取间隔（默认 60 分钟，1~10080 分钟可自定义）均可配置，定时自动获取并检查，低于阈值自动发邮件

### 报表
- 经营看板（今日/本周/本月出入库、预警、待办、7 日趋势）、进销存汇总（期初+入-出=结存）、库存报表（周转/呆滞）、Excel 导出、2D 货架图、盘点收发存导出

### 认证与系统管理
- Session 登录（连续失败 3 次需验证码）、修改密码（踢其他会话）、忘记密码（SMTP 邮箱发码/联系管理员电话）、注册三模式（开放/审核/关闭）
- 用户/角色权限（24 权限点、按单位过滤货架）、注册审核、单位管理、操作日志、系统设置（OCR/大模型/水印/注册/找回/SMTP）、数据库备份（手动 + 每日 02:00 自动，保留 14 份）
- 入口：电脑端 `/`、手机端 `/m/`；用户手动选择优先于设备检测；已登录直进主页

## 技术栈

- 前端：React 19 + TypeScript + Vite + Zustand + Ant Design（电脑端）/ Ant Design Mobile（手机端），npm workspaces monorepo
- 后端：Python 3.13 + FastAPI + SQLAlchemy 2.x + MySQL 5.7/8.0（phpstudy 5.7 开发，生产 8.0）
- OCR：PaddleOCR（默认）/ RapidOCR-json（可切换，`OCRClient` 抽象）
- 大模型：SiliconFlow 视觉（送货单/商品识别）、DeepSeek 文本（纠错/分类/摘要/查重/别名）、豆包视觉（兜底）

## 目录结构

```
进销存/
├─ AI开发文档/          # 全部设计文档（见下表）
├─ backend/            # FastAPI 后端
│  ├─ app/{api,core,models,schemas,services}
│  ├─ sql/init.sql     # 全量建表 + 种子数据（幂等）
│  ├─ tests/           # pytest 接口测试
│  ├─ ocr/             # RapidOCR 引擎资产（不入库）
│  └─ data/{files,backups}
├─ frontend/           # npm workspaces
│  ├─ apps/desktop     # 电脑端（Antd）
│  ├─ apps/mobile      # 手机端（Antd Mobile）
│  └─ packages/shared  # api client / 类型 / 工具
└─ testdata/           # 真实样本（送货单/物品标签/模板表格/手写出货单）
```

## 设计文档（AI开发文档/，开发基线，修改须同步代码）

| 文档 | 说明 |
|---|---|
| 需求大纲.md | 功能需求与已确认事项 |
| 数据库设计.md | 39 张表结构与设计决策 |
| 后端API设计.md | 接口清单、权限点、错误码 |
| 前端设计.md / UI设计方案.md | 页面/组件/视觉规范 |
| 开发排期.md | 阶段划分与里程碑（P0-P9） |
| 开发规范.md | **开发强制流程**（Git/目录/代码/验证门禁 L1-L5） |
| AI赋能设计.md | P9 AI 功能设计（9 项）+ **testdata 样本数据说明** |
| 开发进度记录.md | 阶段完成/验证/遗留（与 git 提交一一对应） |
| 工具使用记录.md | 开发工具清单与实战踩坑 |

## 开发流程（严格遵循《开发规范.md》）

1. **设计先行**：改需求/接口/数据库文档 → 评审 → 再写代码；代码与设计不一致视为缺陷
2. **小步提交**：每功能一个提交，格式 `类型(范围): 描述`（feat/fix/docs/refactor/test/chore）
3. **验证门禁**（提交前必须）：
   - L1 语法/类型：`python -m compileall app`；`npm run typecheck`（零错误）
   - L2 接口：`scripts/run_tests.sh`——普通改动自动跑**针对性测试**（按 git diff 映射）；发布/关键变更用 `scripts/run_tests.sh --full` 跑全量（详见《开发规范.md》§6.1 分层策略）
   - L4 前端：`npm run build -w wlt-desktop`、`npm run build -w wlt-mobile`（发布/关键变更时）
   - 测试/构建失败**不允许提交**
4. **文档同步**：每项完成后回写《开发进度记录.md》（交付/验证/遗留/提交）；接口/表结构变更同步《后端API设计.md》《数据库设计.md》
5. **数据红线**：禁止物理删除业务数据（用状态位）；库存变动必须走 `post_stock_change()`；API Key 只存 sys_config 并脱敏；.env 不入库

## 本地开发环境

- Python 3.13、MySQL 5.7（phpstudy，`root/CHANGE_ME`，端口 3306）、Node 20、Redis 5.x（127.0.0.1:6379；缓存加速层，不可用时自动降级直查数据库）
- 端口：后端 **8443（HTTPS，自签名）**、电脑端 dev **5174**、手机端 dev **5175**（本地 80 被 phpstudy 业务占用）
- 后端需配置大模型 Key（系统设置 → OCR 与大模型）：视觉 SiliconFlow + 文本 DeepSeek（豆包可选）

## 快速启动

**一键启动（推荐）**：双击仓库根目录的 `启动后端.bat`（HTTPS 8443）、`启动桌面端.bat`（5174）、`启动手机端.bat`（5175），或 `一键启动全部.bat` 同时拉起三者（各占一个窗口，自动检查 venv/证书/npm，首次自动 `npm install`）。三个服务窗口**常驻不自动关闭**：服务退出/启动失败后按任意键可重启，关闭窗口即停止对应服务。以下为手动命令（与启动器等价）：

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

## 生产部署（Windows + Nginx + HTTPS）

1. **数据库**：MySQL 8.0 建库 `wuliaotong`（utf8mb4），导入 `backend/sql/init.sql`（幂等，可重复执行）
2. **后端**：
   - 安装 Python 3.13 + `pip install -r requirements.txt`；配置 `backend/.env`（DB_URL、SESSION_COOKIE_NAME、BACKUP_MYSQLDUMP 指向 mysqldump 绝对路径、BACKUP_DIR、REDIS_URL）
   - 启动 Redis 并保持运行（缓存加速层；Redis 挂掉时自动降级，业务不受影响）
   - 启动：`uvicorn app.main:app --host 127.0.0.1 --port 8080`（内网端口，由 Nginx 反代；生产 HTTPS 由 Nginx 终止）
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
    location /api/ { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
}
server { listen 80; server_name 你的域名; return 301 https://$host$request_uri; }
```

5. **大模型配置**：登录后进入 系统设置 → OCR 与大模型，填入 SiliconFlow（视觉，模型如 `nex-agi/Nex-N2-Pro`）与 DeepSeek（文本）API Key，保存后「获取模型列表」选择模型
6. **验证**：`GET https://域名/api/v1/health` 返回 ok；登录联调；`AI 调用日志`页确认大模型链路正常
7. **备份**：每日 02:00 自动 mysqldump → gzip（保留 14 份）；也可系统管理手动备份/下载

## 默认账号

- 管理员：`admin` / `admin123`（首次登录后请立即修改；密码 bcrypt 存储）
- 测试用户：`tester_user` / `123456`

## 测试样本（testdata）

按用途分目录存放真实样本（详见《AI开发文档/AI赋能设计.md》样本数据章节）：
`进货单/`（送货单识别基准）、`物品标签/`（商品识别与模板训练）、`匹配导出表格/`与`匹配导入表格/`（收发存模板对照）、`手写出货单/`（手写评估样本位，待补充）、`条码测试/`（条码解码样本：EAN13/Code128/QR、无条码对照、小条码/模糊条码模拟实拍，含用户实拍照片 IMG_3055/3056，均可被服务端 zxing-cpp 解码）

## 本地资源（不入库，需自行放置）

- `backend/ocr/RapidOCR-json.exe` + `backend/ocr/models/`（RapidOCR 引擎资产，Windows 用；PaddleOCR 可在系统设置自动安装）
