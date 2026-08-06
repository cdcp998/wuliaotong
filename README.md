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

## 快速启动（P0 之后）

```bash
# 后端
cd backend
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env
# 初始化数据库
mysql -uroot -proot -e "CREATE DATABASE wuliaotong DEFAULT CHARACTER SET utf8mb4;"
mysql -uroot -proot wuliaotong < sql/init.sql
uvicorn app.main:app --reload --port 8000

# 前端（后续阶段）
cd frontend && npm install && npm run dev
```

## 本地资源（不入库，需自行放置）

- `backend/ocr/RapidOCR-json.exe` + `backend/ocr/models/`（RapidOCR 引擎资产，Windows 用）
