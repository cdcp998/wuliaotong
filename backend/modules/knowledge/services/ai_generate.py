"""knowledge 模块：AI 生成（复用现有 LLMClient + RAG-lite 上下文）与异步任务 worker。

方案 §5.7：POST /knowledge/generate 异步入队（knowledge_generate_task），后台 worker 消费
（ModuleDef.jobs，tick 校验 ENABLED 由框架保证）；生成结果一律落【草稿】待人工审核；
失败重试 ≤2，超时由 LLM 客户端 60s 超时兜底（总时长 <120s）。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.modules.knowledge.models import KnowledgeArticle, KnowledgeGenerateTask
from app.services.llm import chat_text_with_fallback

logger = logging.getLogger("app.knowledge.ai")

SCENE = "knowledge_generate"
MAX_RETRY = 2

_SYSTEM = (
    "你是通信线路运维知识库编辑。请根据给定主题输出结构化的中文维护知识文档（Markdown），"
    "章节固定为：## 背景 / ## 故障现象 / ## 排查步骤 / ## 预防措施。"
    "内容应具体、可操作，避免空话。只输出文档正文，不要输出其他说明。"
)


def generate_article_content(db: Session, topic: str, context: str) -> str:
    """调用大模型生成知识文档正文（未配置模型时抛 LLMNotConfigured → worker 记失败）。"""
    user = f"主题：{topic}\n补充背景：{context or '无'}"
    return chat_text_with_fallback(db, _SYSTEM, user, scene=SCENE)


def _task_ok_input(inp: dict) -> tuple[str, str]:
    topic = (inp.get("topic") or "").strip()
    if not topic:
        return "", ""
    return topic, (inp.get("context") or "").strip()


def knowledge_worker_tick() -> None:
    """后台 worker：处理 queued 生成任务（每 tick 一个；重试 ≤2，成功落草稿）。"""
    db = SessionLocal()
    try:
        while True:
            task = db.scalar(
                select(KnowledgeGenerateTask)
                .where(KnowledgeGenerateTask.status == "queued")
                .order_by(KnowledgeGenerateTask.id)
                .limit(1)
            )
            if task is None:
                return
            task.status = "running"
            db.commit()
            try:
                inp = json.loads(task.input)
                topic, context = _task_ok_input(inp)
                if not topic:
                    raise ValueError("生成主题缺失")
                content = generate_article_content(db, topic, context)
                title = (inp.get("title") or "").strip() or topic[:80]
                article = KnowledgeArticle(
                    title=title, content=content, author_type="ai", status=0,
                    source_task_id=task.id, created_by=task.created_by,
                )
                db.add(article)
                db.flush()
                task.article_id = article.id
                task.status = "success"
                task.finished_at = datetime.now()
                db.commit()
                logger.info("knowledge generate task %s -> article %s", task.id, article.id)
            except Exception as exc:  # noqa: BLE001 worker 异常隔离：记失败/重试
                db.rollback()
                task = db.get(KnowledgeGenerateTask, task.id)
                if task is None:
                    return
                task.retry_count += 1
                task.last_error = str(exc)[:300]
                if task.retry_count < MAX_RETRY:
                    task.status = "queued"
                    logger.warning("knowledge generate task %s 第 %s 次失败，重试：%s", task.id, task.retry_count, exc)
                else:
                    task.status = "failed"
                    task.finished_at = datetime.now()
                    logger.error("knowledge generate task %s 失败：%s", task.id, exc)
                db.commit()
    finally:
        db.close()


knowledge_worker_tick.interval_minutes = 1 / 12  # 约 5 秒一轮（scheduler 模块 job 注册用）
