# 物料通后端镜像（FastAPI + uvicorn）
# 说明：pip 安装完整 requirements（含 PaddleOCR）；首次 OCR 识别时 PaddleOCR 自动下载模型（需外网），
#       也可将离线模型挂载到容器的 /root/.paddlex 复用。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# PaddleOCR 运行时依赖 libgomp1；curl 供容器健康检查
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app
COPY sql ./sql
COPY scripts ./scripts
# .env.example 作为默认配置；docker-compose 通过环境变量覆盖 DB_URL/REDIS_URL（load_dotenv 不覆盖已存在环境变量）
COPY .env.example .env

# 上传/照片存储 + 备份 + 初始化标记文件目录（挂载持久卷）
RUN mkdir -p /app/data/files /app/data/backups

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
  CMD curl -fsS http://127.0.0.1:8000/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
