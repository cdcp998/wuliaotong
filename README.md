# 物料通管理系统

企业内部物料仓库管理系统：**入库、出库、维修使用（领用）**，支持手机/平板/电脑三端，拍照 + OCR + 大模型辅助录入。

## 已实现功能（截至 2026-08-06，pytest 65/65 + 两端 build 通过）

- **基础资料**：商品（编码纯数字自动生成 + 物料编码/公司系统编码 + 条码）、分类、计量单位、供应商、仓库/货架/库位（2D 分层货架图，按单位过滤）；Excel 导入（兼容公司 13 列表头模板）
- **库存**：采购入库（作废冲销）、期初库存、库存查询/流水、调拨、盘点（拍照留痕）、其他出入库、库存预警（定时任务+站内通知）
- **领用**：手机申请（物品/使用地点拍照可选）→ **提交即自动出库**（库存不足先负数并通知管理员核对）→ 仓管员审计（驳回/取消自动回补库存）
- **OCR/大模型**：RapidOCR-json 本地识别（引擎可切换 PaddleOCR）、送货单 OCR 录入、商品拍照快查、豆包视觉 AI 建议新增商品、DeepSeek 文本结构化（Key 后台配置）
- **报表**：经营看板（今日/本周/本月出入库+预警+待办+7日趋势）、进销存汇总（期初+入-出=结存）、库存报表（周转/呆滞）、Excel 导出
- **认证**：Session 登录（连续失败 3 次需验证码）、修改密码、忘记密码（邮箱 SMTP 发码/联系管理员电话，系统设置配置）、注册（开放/审核/关闭，审核注册有管理端审核页）
- **系统管理**：用户（含邮箱）、角色与权限（含所属单位）、注册审核、单位管理（配置可用货架）、操作日志、系统设置（OCR/大模型/注册/找回/SMTP）、数据库备份（手动+每日 02:00 自动，保留 14 份）
- **入口**：电脑端 `/`、手机端 `/m/`（Nginx 反代分发）；用户手动选择优先于设备检测；已登录直进主页；图片悬浮/点击预览（不下载）

## 技术栈

- 前端：React 18 + TypeScript + Vite + Zustand + Ant Design（电脑端）/ Ant Design Mobile（手机端），monorepo（apps/mobile、apps/desktop、packages/shared）
- 后端：Python 3.13 + FastAPI + SQLAlchemy 2.x + MySQL
- OCR：RapidOCR-json（Windows 本地）/ PaddleOCR（Debian/Linux），引擎可配置切换（`OCRClient` 抽象）

## 设计文档（开发基线，修改须同步代码）

| 文档 | 说明 |
|---|---|
| 需求大纲.md | 功能需求与已确认事项 |
| 数据库设计.md | 39 张表结构与设计决策 |
| 后端API设计.md | 接口清单、权限点、错误码 |
| 前端设计.md | 页面/组件/store 结构 |
| 开发排期.md | 阶段划分与里程碑 |
| 开发规范.md | **开发强制流程**（Git/目录/代码/验证门禁） |
| 开发进度记录.md | 阶段完成内容/验证/遗留/下一步（跨会话防失忆，与 git 提交一一对应） |
| 工具使用记录.md | 开发工具清单与实战踩坑（Kun 运行时备忘） |

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

## 生产部署（P8 计划中）

- Nginx 反向代理：`/` → 电脑端 dist、`/m/` → 手机端 dist（vite base=/m/ + 路由 basename=/m/），HTTPS 正式证书
- 后端：uvicorn + MySQL 8.0，端口 8080；Session Cookie Secure+HttpOnly；`BACKUP_MYSQLDUMP` 指向 mysqldump 绝对路径
- 备份目录：`backend/data/backups`（gzip 压缩的 mysqldump，每日 02:00 自动备份）

## 默认账号

- 管理员：`admin` / `admin123`（首次登录后请立即修改，密码 bcrypt 存储）

## 本地资源（不入库，需自行放置）

- `backend/ocr/RapidOCR-json.exe` + `backend/ocr/models/`（RapidOCR 引擎资产，Windows 用）
