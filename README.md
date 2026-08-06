# 物料通管理系统

企业内部物料仓库管理系统：**入库、出库、维修使用（领用）**，支持手机/平板/电脑三端，拍照 + OCR + 大模型辅助录入。

## 技术栈

- 前端：React 18 + TypeScript + Vite + Zustand + Ant Design（电脑端）/ Ant Design Mobile（手机端），monorepo（apps/mobile、apps/desktop、packages/shared）
- 后端：Python 3.13 + FastAPI + SQLAlchemy 2.x + MySQL
- OCR：RapidOCR-json（Windows 本地）/ PaddleOCR（Debian/Linux），引擎可配置切换（`OCRClient` 抽象）

## 设计文档（开发基线，修改须同步代码）

| 文档 | 说明 |
|---|---|
| 需求大纲.md | 功能需求与已确认事项 |
| 数据库设计.md | 34 张表结构与设计决策 |
| 后端API设计.md | 接口清单、权限点、错误码 |
| 前端设计.md | 页面/组件/store 结构 |
| 开发排期.md | 阶段划分与里程碑 |
| 开发规范.md | **开发强制流程**（Git/目录/代码/验证门禁） |

## 本地开发环境

- Python 3.13（`G:\Python\Python313`）
- MySQL 5.7（phpstudy，root/root，端口 3306），生产目标 MySQL 8.0
- Node 20 + npm workspaces
- ⚠️ 本地 80 端口被 phpstudy 业务占用：后端 dev 端口 **8443（HTTPS）**，前端 dev **HTTPS 5173/5174**，部署端口计划 **8080**
- MySQL 密码：root/cdcp520

## 快速启动（P0 已就绪）

```bash
# 1. 生成开发者自签名证书（已生成则跳过）
cd backend && mkdir -p certs/dev
openssl req -x509 -newkey rsa:2048 -keyout certs/dev/key.pem -out certs/dev/cert.pem \
  -days 365 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# 2. 后端（HTTPS，端口 8443；浏览器首次访问需信任自签名证书）
cd backend
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env
# 初始化数据库（MySQL 需已启动）
mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS wuliaotong DEFAULT CHARACTER SET utf8mb4;"
mysql -uroot -proot wuliaotong < sql/init.sql
uvicorn app.main:app --host 0.0.0.0 --port 8443 \
  --ssl-keyfile certs/dev/key.pem --ssl-certfile certs/dev/cert.pem

# 3. 接口测试（L2 门禁）
cd backend && .venv/Scripts/python.exe -m pytest tests -q

# 4. 前端（HTTPS，端口 5173/5174；复用 backend/certs/dev 自签名证书）
cd frontend && npm install
npm run dev:desktop   # https://localhost:5173
npm run dev:mobile    # https://localhost:5174
```

## 默认账号

- 管理员：`admin` / `admin123`（首次登录后请立即修改，密码 bcrypt 存储）

## 本地资源（不入库，需自行放置）

- `backend/ocr/RapidOCR-json.exe` + `backend/ocr/models/`（RapidOCR 引擎资产，Windows 用）
