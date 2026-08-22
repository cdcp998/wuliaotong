"""从真实商品标签照片批量训练本地 OCR 商品识别模板（处理 testdata/物品标签，图片保留原路径）。

与 scripts/ocr_ai_train.py 的 product 模式同源（视觉模型标注 → build_anchors → 本地 OCR
验证锚点 → 写 sys_config ocr.product_templates），区别是本脚本直接处理真实照片目录，
不渲染合成图。

流水线（每张图）：
① 本地 OCR（按 sys_config ocr.engine 选择 PaddleOCR/RapidOCR；启动失败自动降级另一引擎）
   → 文本行（本地 OCR 是核心执行体，后续锚点验证依赖它）
② 视觉模型识图（默认 Qwen/Qwen3.6-35B-A3B，--model 可覆盖）→
   {product_name, brand, spec}；提示词附上①的本地 OCR 文本行作为字符级证据
   （视觉模型负责语义结构化，本地 OCR 负责文字证据，两者互补）
③ build_anchors 提取锚点（品牌/规格/商品名，长度≥2 去重）；仅保留被本地 OCR 实际读到的
   锚点，未读到的丢弃并告警（模板匹配依赖本地 OCR 文本，锚点必须可被读到）
④ 合并写入 sys_config ocr.product_templates（锚点完全相同则覆盖旧模板）；JSON 报告导出
   到 --out（默认 backend/data/ocr_templates_物品标签.json）

用法（cd backend，用项目 venv）：
.venv/Scripts/python.exe scripts/ocr_train_from_photos.py
.venv/Scripts/python.exe scripts/ocr_train_from_photos.py --dir testdata/物品标签 --model Qwen/Qwen3.6-35B-A3B --dry-run
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))

from PIL import Image  # noqa: E402

import app.services.llm as llm_mod  # noqa: E402

llm_mod.LLM_TIMEOUT = 180  # 35B-A3B 冷启动/排队可能超过默认 60s

from app.db import SessionLocal  # noqa: E402
from app.services.llm import SiliconFlowClient  # noqa: E402
from app.services.ocr.client import OCRInitError, RapidOCREngine, get_ocr_engine  # noqa: E402
from app.services.ocr.product_template import build_anchors, load_templates, save_templates  # noqa: E402

# 与 backend/app/api/ocr.py 的 VISION_PRODUCT_PROMPT 一致，附加本地 OCR 文本行辅助
VISION_PRODUCT_PROMPT = (
    "你是商品识别助手。识别图片中商品包装/标签上的商品信息，只输出一个 JSON 对象，不要解释。"
    "字段：product_name(商品名称，如「8口千兆以太网交换机」)、brand(品牌，如「H3C」，可空)、"
    "spec(规格型号，如「S2G Pro」，可空)。无法判断的字段留空。"
)

MAX_VISION_SIDE = 1600  # 视觉模型入图前等比缩到该边长（控制 token/耗时），本地 OCR 用原图


def _cfg(db, key: str, default: str = "") -> str:
    from sqlalchemy import select

    from app.models.sys import SysConfig

    try:
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
        if cfg and cfg.config_value:
            return cfg.config_value
    except Exception:  # noqa: BLE001 配置读取失败按默认值
        pass
    return default


def _downscale(img_bytes: bytes, max_side: int = MAX_VISION_SIDE) -> bytes:
    """等比缩图后转 JPEG，供视觉模型使用（原图字节不改动）。"""
    img = Image.open(io.BytesIO(img_bytes))
    img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > max_side:
        scale = max_side / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=90)
    return out.getvalue()


def _local_ocr_texts(db, data: bytes, engine_name: str | None) -> tuple[list[str], str]:
    """本地 OCR：优先配置引擎，失败降级另一引擎；返回 (文本行, 实际引擎名)。"""
    tried = []
    if engine_name is None:
        engine_name = _cfg(db, "ocr.engine", "paddle")
    for name in (engine_name, "rapidocr" if engine_name == "paddle" else "paddle"):
        if name in tried:
            continue
        tried.append(name)
        try:
            engine = get_ocr_engine(db, engine=name)
            lines = engine.recognize(data)
            return [ln.text for ln in lines if ln.text.strip()], name
        except (ValueError, OCRInitError, Exception) as e:  # noqa: BLE001 引擎失败换下一个
            print(f"  AI_TRAIN: 本地 OCR 引擎 {name} 失败: {e}")
    return [], tried[-1] if tried else "none"


def _vision_annotate(db, image_bytes: bytes, model: str, ocr_lines: list[str]) -> dict | None:
    """视觉模型识图 → {product_name, brand, spec}；失败返回 None。"""
    key = _cfg(db, "llm.siliconflow.api_key")
    if not key:
        print("  AI_TRAIN: 视觉模型未配置，跳过视觉识别")
        return None
    client = SiliconFlowClient(
        api_key=key,
        base_url=_cfg(db, "llm.siliconflow.base_url", "https://api.siliconflow.cn/v1"),
        model=model,
    )
    prompt = VISION_PRODUCT_PROMPT
    if ocr_lines:
        prompt += (
            "\n下面是本地 OCR 引擎从该图片读出的文字行（字符可能有误，仅作辅助参考，"
            "不要编造其内容）：\n" + "\n".join(ocr_lines)
        )
    last_err = None
    for attempt in range(3):  # 网络/限流/超时重试，最多 3 次
        try:
            content = client.chat_image(_downscale(image_bytes), prompt, scene="ocr_train_from_photos")
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"  视觉调用第{attempt + 1}次失败: {e}，重试...")
            time.sleep(3 * (attempt + 1))
    else:
        print(f"  视觉调用 3 次均失败: {last_err}")
        return None
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end < 0:
        return None
    obj = json.loads(content[start : end + 1])
    if not isinstance(obj, dict):
        return None
    return {
        "product_name": str(obj.get("product_name") or "").strip(),
        "brand": str(obj.get("brand") or "").strip(),
        "spec": str(obj.get("spec") or "").strip(),
    }


def _blob(texts: list[str]) -> str:
    return "".join(texts).replace(" ", "").replace("\u3000", "").replace("\t", "")


def main() -> int:
    ap = argparse.ArgumentParser(description="真实商品标签照片 → 本地 OCR 商品识别模板")
    ap.add_argument("--dir", default=str(ROOT.parent / "testdata" / "物品标签"), help="照片目录（默认 testdata/物品标签）")
    ap.add_argument("--model", default="Qwen/Qwen3.6-35B-A3B", help="视觉模型 ID")
    ap.add_argument("--out", default=str(ROOT / "data" / "ocr_templates_物品标签.json"), help="JSON 报告/模板导出路径")
    ap.add_argument("--dry-run", action="store_true", help="只识别不写数据库，报告仍导出到 --out")
    args = ap.parse_args()

    img_dir = Path(args.dir)
    images = sorted(
        p for p in img_dir.iterdir()
        if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp", ".webp")
    )
    if not images:
        print(f"AI_TRAIN: 目录无图片: {img_dir}")
        return 1
    print(f"AI_TRAIN: 处理 {len(images)} 张图片 @ {img_dir}（模型 {args.model}）")

    db = SessionLocal()
    existing = load_templates(db)
    print(f"AI_TRAIN: 现有模板 {len(existing)} 个")
    by_anchors = {tuple(t.get("anchors") or []): t for t in existing}

    report: dict = {"dir": str(img_dir), "model": args.model, "images": []}
    new_templates: list[dict] = []

    for idx, path in enumerate(images, 1):
        print(f"\n[{idx}/{len(images)}] {path.name}")
        data = path.read_bytes()
        ocr_lines, engine = _local_ocr_texts(db, data, None)
        print(f"  本地OCR({engine}): {len(ocr_lines)} 行 -> {' | '.join(ocr_lines[:6])}")
        try:
            prod = _vision_annotate(db, data, args.model, ocr_lines)
        except Exception as e:  # noqa: BLE001 单图失败不中断整体
            print(f"  视觉识别异常: {e}")
            prod = None
        if not prod or not (prod.get("product_name") or prod.get("spec")):
            print(f"  视觉识别: 未识别出商品信息（{prod if prod else '调用失败'}），跳过")
            report["images"].append({"file": path.name, "engine": engine, "ocr_lines": ocr_lines,
                                     "vision": prod, "skipped": True})
            continue
        print(f"  视觉识别(Qwen): {prod}")

        anchors = build_anchors(prod)
        blob = _blob(ocr_lines)
        kept, dropped = [], []
        for a in anchors:
            (kept if a.replace(" ", "") in blob else dropped).append(a)
        if dropped:
            print(f"  锚点校验: 本地 OCR 未读到，丢弃 {dropped}")
        if not kept:
            print("  锚点校验: 全部锚点未被本地 OCR 读到，跳过（避免生成无效模板）")
            report["images"].append({"file": path.name, "engine": engine, "ocr_lines": ocr_lines,
                                     "vision": prod, "anchors": anchors, "dropped": dropped,
                                     "skipped": True})
            continue
        tpl = {
            "id": uuid.uuid4().hex[:8],
            "name": prod.get("product_name") or prod.get("spec") or "未命名模板",
            "brand": prod.get("brand") or "",
            "product_name": prod.get("product_name") or "",
            "spec": prod.get("spec") or "",
            "anchors": kept,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        new_templates.append(tpl)
        report["images"].append({"file": path.name, "engine": engine, "ocr_lines": ocr_lines,
                                 "vision": prod, "anchors": kept, "dropped": dropped, "template": tpl})
        print(f"  模板: {tpl}")

    # 合并：锚点完全相同则覆盖，其余追加
    for tpl in new_templates:
        by_anchors[tuple(tpl["anchors"])] = tpl
    merged = list(by_anchors.values())

    report["templates"] = merged
    report["summary"] = {
        "images": len(images),
        "templates_created": len(new_templates),
        "templates_total": len(merged),
        "dry_run": args.dry_run,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nAI_TRAIN: 报告已导出 -> {out}")

    if args.dry_run:
        print(f"AI_TRAIN: --dry-run，未写数据库（模板 {len(new_templates)} 个）")
        return 0
    save_templates(db, merged)
    print(f"AI_TRAIN: 已写入 sys_config ocr.product_templates（共 {len(merged)} 个）")
    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
