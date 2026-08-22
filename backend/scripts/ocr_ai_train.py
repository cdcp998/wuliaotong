"""识图/生图模型辅助本地 OCR 模板训练（AI 合成训练流水线）。

设计文档：《AI开发文档/AI赋能设计.md》P9-⑪。
原则：**本地 OCR 是核心执行体**（识别/解析/匹配全部走本地引擎）；
识图模型（视觉大模型）与生图模型（视觉大模型 images/generations）
只做训练辅助——自动标注、样本校验、纹理素材。

流水线：
  ① 程序化合成渲染（精确文字 + 随机变体，每张图自带 ground-truth JSON）
  ② 生图模型（--gen-bg）：生成纸张纹理背景叠加进合成图（文字仍程序化渲染，
     因为文生图模型渲染密集中文表格文字不可控——详见设计文档能力边界）
  ③ 识图模型（--vision）：自动标注/校验每张合成图（结构化 JSON），
     与 ground-truth 字段级对比，准确率 < --threshold 的样本剔除
  ④ 本地 OCR（--engine）：识别合成图 → 文本行 + 坐标
  ⑤ 模板训练：
     - product 模式：视觉标注（校正后）+ 本地 OCR 文本 → build_anchors 生成/更新
       商品模板（写现有 sys_config 模板库，source=ai_train；锚点须被本地 OCR
       实际读到，否则丢弃并告警——模板匹配依赖本地 OCR 文本）
     - delivery 模式：parse_delivery / parse_delivery_generic 跑本地解析 →
       字段级评测报告；通过校验的合成样本（图+标注+OCR 结果）归档
       data/ocr_training/送货单-合成/ 供后续训练/回归

用法示例（cd backend，用项目 venv）：
  # 冒烟：零外部依赖（渲染 3 张 + 本地 OCR + 本地解析）
  .venv/Scripts/python.exe scripts/ocr_ai_train.py --mode self-test

  # 送货单：合成 8 张（含生图纹理背景）→ 视觉模型识图校验 → 本地 OCR → 评测报告
  .venv/Scripts/python.exe scripts/ocr_ai_train.py --mode delivery --count 8 \
      --vision siliconflow --gen-bg

  # 商品标签：合成 5 张 → 识图标注 → 本地 OCR 验证锚点 → 模板写入 sys_config
  .venv/Scripts/python.exe scripts/ocr_ai_train.py --mode product --count 5 --vision siliconflow

  # 无 Key/无库降级：--vision off --no-db（仅渲染 + 本地 OCR + 评测/本地模板文件）
  .venv/Scripts/python.exe scripts/ocr_ai_train.py --mode delivery --count 2 --vision off --no-db

输出：--out（默认 backend/data/ocr_training/synthetic/）按模式分目录；每样本
img.png + gt.json + vision.json + ocr.json + result.json；根 report.json。
控制台关键行以 "AI_TRAIN:" 前缀输出，便于 grep。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import random
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

try:
    import httpx  # noqa: E402
except ImportError:  # 生图/识图需要；纯渲染 + 本地 OCR 不需要
    httpx = None

# ============================ 字体 ============================

_FONT_CANDIDATES: list[tuple[str, str]] = [
    # (常规, 粗体)；粗体缺失时回退常规
    (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhbd.ttc"),
    (r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simhei.ttf"),
    (r"C:\Windows\Fonts\simsun.ttc", r"C:\Windows\Fonts\simsun.ttc"),
    (r"C:\Windows\Fonts\simkai.ttf", r"C:\Windows\Fonts\simkai.ttf"),
    (r"C:\Windows\Fonts\Deng.ttf", r"C:\Windows\Fonts\Dengb.ttf"),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
    ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
]
_FONT_CACHE: dict[tuple[str, int, bool], ImageFont.FreeTypeFont] = {}


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for normal, bold_path in _FONT_CANDIDATES:
        path = bold_path if bold else normal
        if not Path(path).is_file():
            continue
        key = (path, size, bold)
        if key not in _FONT_CACHE:
            try:
                _FONT_CACHE[key] = ImageFont.truetype(path, size)
            except OSError:
                continue
        return _FONT_CACHE[key]
    return ImageFont.load_default()


def _fit_font(draw: ImageDraw.ImageDraw, text: str, size: int, bold: bool, max_w: int) -> ImageFont.FreeTypeFont:
    """按列宽自动缩字号（最小 12），保证单元格文字不溢出。"""
    while size >= 12:
        f = _font(size, bold)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 1
    return _font(12, bold)


# ============================ 数据库 / 配置 ============================


def _open_db():
    """连接开发库（读取 sys_config / 写模板库）；失败返回 None（全链路降级）。"""
    try:
        from sqlalchemy import text

        from app.db import SessionLocal

        s = SessionLocal()
        s.execute(text("SELECT 1"))
        return s
    except Exception as e:  # noqa: BLE001 库不可用 → 降级本地文件模式
        print(f"AI_TRAIN: 数据库不可用，降级本地文件模式: {e}")
        return None


def _cfg(db, key: str, env: str = "", default: str = "") -> str:
    """配置优先级：sys_config（系统设置）→ 环境变量 → 默认值。"""
    if db is not None:
        try:
            from sqlalchemy import select

            from app.models.sys import SysConfig

            cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
            if cfg and cfg.config_value:
                return cfg.config_value
        except Exception:  # noqa: BLE001
            pass
    return os.getenv(env, default) if env else default


# ============================ 外部模型（训练辅助） ============================


def _vision_client(db, name: str):
    """识图模型客户端（复用 app.services.llm 的 OpenAI 兼容客户端）。"""
    from app.services.llm import MMLLMClient, SiliconFlowClient

    if name == "mm_llm":
        key = _cfg(db, "llm.mm_llm.api_key", "MM_LLM_API_KEY")
        if not key:
            return None, "多模态大模型未配置"
        base_url = _cfg(db, "llm.mm_llm.base_url", "MM_LLM_BASE_URL")
        model = _cfg(db, "llm.mm_llm.model", "MM_LLM_MODEL")
        if not base_url or not model:
            return None, "多模态大模型未配置 Base URL/模型名"
        return MMLLMClient(api_key=key, base_url=base_url, model=model), "mm_llm"
    key = _cfg(db, "llm.siliconflow.api_key", "SILICONFLOW_API_KEY")
    if not key:
        return None, "视觉模型未配置"
    return SiliconFlowClient(
        api_key=key,
        base_url=_cfg(db, "llm.siliconflow.base_url", "SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1"),
        model=_cfg(db, "llm.siliconflow.model", "SILICONFLOW_MODEL", "nex-agi/Nex-N2-Pro"),
    ), "siliconflow"


DELIVERY_VISION_PROMPT = (
    "识别图片中的送货单，输出JSON：{\"supplier_name\": 供应商名称, \"bill_no\": 单据编号, "
    "\"items\": [{\"material_code\": 物料编码(无此列则空字符串), \"product_name\": 货物名称, "
    "\"spec\": 规格型号, \"unit\": 单位(无此列则空字符串), \"qty\": 数量, \"price\": 单价, "
    "\"amount\": 金额}]}。合计行、大写金额、表头不得作为明细；数字只输出数值不带单位。只输出JSON。"
)
LABEL_VISION_PROMPT = (
    "识别图片中的商品标签/包装，输出JSON：{\"brand\": 品牌, \"product_name\": 商品名称, "
    "\"spec\": 规格型号}。无法识别的字段给空字符串。只输出JSON。"
)


def _annotate(client, img_bytes: bytes, prompt: str) -> dict | None:
    """识图模型自动标注；失败/解析失败返回 None。"""
    if client is None:
        return None
    try:
        content = client.chat_image(img_bytes, prompt, scene="ai_train")
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end < 0:
            return None
        obj = json.loads(content[start:end + 1])
        return obj if isinstance(obj, dict) else None
    except Exception as e:  # noqa: BLE001
        print(f"AI_TRAIN: 识图调用失败: {e}")
        return None


def _gen_texture_bg(db, model: str) -> Image.Image | None:
    """生图模型生成纸张纹理背景（无文字）；失败自动降级返回 None（程序化纹理兜底）。"""
    if httpx is None:
        return None
    key = _cfg(db, "llm.siliconflow.api_key", "SILICONFLOW_API_KEY")
    if not key:
        print("AI_TRAIN: 生图模型未配置（Key），跳过纹理生成，使用程序化纹理")
        return None
    base = _cfg(db, "llm.siliconflow.base_url", "SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1")
    prompt = "一张空白纸张的浅色纹理背景，接近纯白、微带纸纤维质感，无任何文字、无图案、无边框、无阴影"
    for size_key in ("image_size", "size"):  # 兼容不同服务商参数名
        try:
            resp = httpx.post(
                f"{base}/images/generations",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "prompt": prompt, size_key: "1024x1024"},
                timeout=120,
            )
            resp.raise_for_status()
            url = resp.json()["images"][0]["url"]
            raw = httpx.get(url, timeout=60).content
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            # 提亮到接近白纸，避免生成图底色干扰文字对比度
            img = Image.blend(img, Image.new("RGB", img.size, (255, 255, 255)), 0.55)
            print(f"AI_TRAIN: 生图模型纹理生成成功（model={model}）")
            return img
        except Exception as e:  # noqa: BLE001
            print(f"AI_TRAIN: 生图纹理失败（参数 {size_key}）: {e}")
    return None


# ============================ 合成数据（程序化渲染 + 变体） ============================

_SUPPLIERS = [
    "海口耐沃办公设备有限公司", "海南工友商贸有限公司", "深圳市华测电子有限公司",
    "广州市光通电子厂", "海南恒达网络科技有限公司",
]
_CODE_PRODUCTS = [  # (名称, 规格, 单位) —— 标准版式：9~15 位物料编码锚点
    ("千兆POE交换机", "NF-918S", "台"),
    ("8口千兆交换机", "SG108P8L1", "台"),
    ("网线超五类", "TL-SF1005P", "箱"),
    ("光纤收发器", "100mW", "对"),
    ("硬盘录像机", "H21PROS+（A）", "台"),
    ("无线网桥", "GO01", "套"),
    ("监控电源", "FSP-75W", "个"),
    ("光纤跳线", "SC-SC-3M", "条"),
]
_GENERIC_PRODUCTS = [  # (货物名称, 厂家品牌, 规格型号) —— 新格式：无物料编码列
    ("千兆POE交换机", "海康威视", "NF-918S"),
    ("8口千兆交换机", "华三", "SG108P8L1"),
    ("网线超五类", "安普", "TL-SF1005P"),
    ("光纤收发器", "华为", "100mW"),
    ("硬盘录像机", "大华", "H21PROS+（A）"),
    ("无线网桥", "TP-LINK", "GO01"),
    ("监控电源", "小耳朵", "FSP-75W"),
    ("光纤跳线", "烽火", "SC-SC-3M"),
]
_REMARKS = ["", "现货", "加急", "无"]
_BILL_PREFIX = ["POAB", "CG", "PO", "DH", "XS"]

# 列头与列宽（与 template.py / generic_parser.py 的表头词、列角色对齐）
_CODE_COLS = ["行号", "物料编码", "物料名称", "规格型号", "单位", "数量", "含税单价", "价税合计"]
_CODE_COL_W = [44, 112, 168, 132, 44, 74, 90, 98]
_GENERIC_COLS = ["序号", "货物名称", "厂家品牌", "规格型号", "数量", "单价", "金额", "备注"]
_GENERIC_COL_W = [44, 160, 92, 124, 64, 80, 92, 64]


def _paper_bg(size: tuple[int, int], texture: Image.Image | None) -> Image.Image:
    """合成图底色：生图纹理（裁剪缩放）或程序化浅色纸张。"""
    if texture is not None:
        bg = texture.resize(size, Image.LANCZOS)
        return bg
    tint = random.Random(size[0] * 31 + size[1]).randint(246, 252)  # 近白纸色（保持文字对比度）
    return Image.new("RGB", size, (tint, tint, tint - 2))


def _augment(img: Image.Image, rng: random.Random) -> Image.Image:
    """变体增强：噪点 / 轻微模糊 / 整体旋转（±1.8°）。"""
    if rng.random() < 0.9:
        noise = Image.effect_noise(img.size, rng.uniform(8, 20)).convert("RGB")
        img = Image.blend(img, noise, rng.uniform(0.03, 0.06))
    if rng.random() < 0.3:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 0.4)))
    angle = rng.uniform(-1.8, 1.8)
    if abs(angle) > 0.2:
        img = img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))
    return img


def _render_delivery(rng: random.Random, style: str, texture: Image.Image | None) -> tuple[Image.Image, dict]:
    """渲染送货单（style=code 标准版式 / generic 新格式），返回 (图, ground-truth)。"""
    supplier = rng.choice(_SUPPLIERS)
    bill_no = f"{rng.choice(_BILL_PREFIX)}{rng.randrange(10**11, 10**12)}"
    n = rng.randint(1, 8)
    cols = _CODE_COLS if style == "code" else _GENERIC_COLS
    col_w = _CODE_COL_W if style == "code" else _GENERIC_COL_W
    table_w = sum(col_w)
    pad_l = 40
    canvas_w = table_w + pad_l * 2
    row_h, header_h = 40, 42
    top = 132
    canvas_h = top + header_h + row_h * (n + 1) + 70  # +1 合计行；底部日期

    img = _paper_bg((canvas_w, canvas_h), texture)
    draw = ImageDraw.Draw(img)

    # 标题
    title = "送货单" if style == "code" else "货物采购签收单"
    tf = _font(30, bold=True)
    tw = draw.textlength(title, font=tf)
    draw.text(((canvas_w - tw) / 2, 24), title, font=tf, fill=(15, 15, 15))

    # 供应商 / 单号行（表头词与 template.py / generic_parser.py 正则对齐）
    sf = _font(20)
    supplier_line = f"供应商：{supplier}" if style == "code" else f"供货单位：{supplier}"
    draw.text((pad_l, 82), supplier_line, font=sf, fill=(15, 15, 15))
    bill_line = f"送货单号：{bill_no}"
    bw = draw.textlength(bill_line, font=sf)
    draw.text((canvas_w - pad_l - bw, 82), bill_line, font=sf, fill=(15, 15, 15))

    # 明细
    items: list[dict] = []
    cells = [title, supplier_line, bill_line]
    xs = [pad_l + sum(col_w[:i]) for i in range(len(col_w))]
    x_end = pad_l + table_w

    def cell_text(x: int, y: int, text: str, bold: bool = False, size: int = 20) -> None:
        if not text:
            return
        f = _fit_font(draw, text, size, bold, col_w[xs.index(x)] - 20)
        jx, jy = rng.randint(-1, 1), rng.randint(-1, 1)
        draw.text((x + 10 + jx, y + (row_h - size) / 2 + jy), text, font=f, fill=(20, 20, 20))
        cells.append(text)

    y = top
    # 表头
    hf = _font(21, bold=True)
    for i, c in enumerate(cols):
        draw.text((xs[i] + 10, y + (header_h - 21) / 2), c, font=hf, fill=(10, 10, 10))
        cells.append(c)
    draw.rectangle([pad_l, y, x_end, y + header_h], outline=(140, 140, 140), width=2)
    y += header_h

    total = 0.0
    for idx in range(1, n + 1):
        if style == "code":
            name, spec, unit = rng.choice(_CODE_PRODUCTS)
            code = str(rng.randint(10**8, 999_999_999_999_999))  # 9~15 位
        else:
            name, brand, spec = rng.choice(_GENERIC_PRODUCTS)
            code, unit = "", ""
        qty = rng.randint(1, 200)
        price = round(rng.uniform(3, 3000), 2)
        amount = round(qty * price, 2)
        total += amount
        row = {
            "material_code": code, "product_name": name, "spec": spec, "unit": unit,
            "qty": f"{qty}.00", "price": f"{price:.2f}", "amount": f"{amount:.2f}",
        }
        items.append(row)
        row_cells = (
            [str(idx), code, name, spec, unit, row["qty"], row["price"], row["amount"]]
            if style == "code"
            else [str(idx), name, brand, spec, row["qty"], row["price"], row["amount"], rng.choice(_REMARKS)]
        )
        for i, t in enumerate(row_cells):
            cell_text(xs[i], y, t)
        draw.rectangle([pad_l, y, x_end, y + row_h], outline=(200, 200, 200), width=1)
        y += row_h

    # 合计行
    total_s = f"{round(total, 2):.2f}"
    cell_text(xs[0], y, "合计", bold=True)
    draw.text((xs[-1] + 10, y + (row_h - 21) / 2), total_s, font=_font(20, bold=True), fill=(20, 20, 20))
    cells.append(total_s)
    draw.rectangle([pad_l, y, x_end, y + row_h], outline=(140, 140, 140), width=2)
    y += row_h

    date_line = f"日期：{datetime.now():%Y-%m-%d}"
    draw.text((pad_l, y + 14), date_line, font=_font(18), fill=(60, 60, 60))
    cells.append(date_line)

    img = _augment(img, rng)
    gt = {
        "kind": "delivery", "style": style, "supplier_name": supplier, "bill_no": bill_no,
        "items": items, "cells": cells, "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    return img, gt


def _render_label(rng: random.Random, texture: Image.Image | None) -> tuple[Image.Image, dict]:
    """渲染商品标签（品牌/名称/规格 + 装饰条码），返回 (图, ground-truth)。"""
    w, h = 640, 440
    img = _paper_bg((w, h), texture)
    draw = ImageDraw.Draw(img)
    brand = rng.choice(["H3C", "海康威视", "TP-LINK", "华为", "大华", "烽火"])
    name, spec, _ = rng.choice(_CODE_PRODUCTS)
    draw.rectangle([18, 18, w - 18, h - 18], outline=(90, 90, 90), width=3)

    # 品牌（左上）
    draw.text((40, 44), brand, font=_font(28, bold=True), fill=(15, 15, 15))
    # 装饰圆点
    draw.ellipse([w - 90, 40, w - 50, 80], outline=(120, 120, 120), width=2)

    # 商品名称（中）
    nf = _fit_font(draw, name, 34, True, w - 120)
    nw = draw.textlength(name, font=nf)
    draw.text(((w - nw) / 2, 150), name, font=nf, fill=(10, 10, 10))

    # 规格（名称下方）
    sf = _fit_font(draw, spec, 26, False, w - 120)
    sw = draw.textlength(spec, font=sf)
    draw.text(((w - sw) / 2, 220), spec, font=sf, fill=(40, 40, 40))

    # 装饰条码（不可解码，仅供视觉版式参考）
    bx, by = 180, 300
    bw_total = 0
    while bw_total < 280:
        bar_w = rng.randint(1, 3)
        draw.rectangle([bx + bw_total, by, bx + bw_total + bar_w, by + 70], fill=(20, 20, 20))
        bw_total += bar_w + rng.randint(1, 3)

    img = _augment(img, rng)
    gt = {
        "kind": "label", "brand": brand, "product_name": name, "spec": spec,
        "cells": [brand, name, spec], "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    return img, gt


# ============================ 本地 OCR / 评测 ============================


def _local_ocr(engine: str | None, img_bytes: bytes) -> tuple[list[str], list] | None:
    """本地 OCR 识别（核心执行体）：返回 (lines, boxes)；失败/引擎关闭返回 None。"""
    if engine == "off":
        return None
    try:
        from app.services.ocr.client import get_ocr_engine

        eng = get_ocr_engine(db=None, engine=engine)
        res = eng.recognize(img_bytes)
        return [l.text for l in res], [l.box for l in res]
    except Exception as e:  # noqa: BLE001
        print(f"AI_TRAIN: 本地 OCR 识别失败: {e}")
        return None


def _num(v) -> float | None:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


_FIELDS = ("material_code", "product_name", "spec", "unit", "qty", "price", "amount")


def _field_ok(a: dict, b: dict, field: str) -> bool:
    av, bv = (a.get(field) or ""), (b.get(field) or "")
    if not av and not bv:
        return True
    if not av or not bv:
        return False
    na, nb = _num(av), _num(bv)
    if na is not None and nb is not None:
        return abs(na - nb) < 0.01
    return str(av).strip() == str(bv).strip()


def _compare_items(gt_items: list[dict], parsed_items: list[dict]) -> dict:
    """字段级对比（只比 gt 中存在的字段；数字容差 0.01）。"""
    total = hit = 0
    exact = 0
    for gi, pi in zip(gt_items, parsed_items):
        fields = [f for f in _FIELDS if gi.get(f) not in (None, "")]
        if not fields:
            continue
        ok = all(_field_ok(gi, pi, f) for f in fields)
        total += len(fields)
        hit += sum(1 for f in fields if _field_ok(gi, pi, f))
        exact += 1 if ok else 0
    return {
        "n_gt": len(gt_items),
        "n_parsed": len(parsed_items),
        "field_accuracy": round(hit / total, 4) if total else 0.0,
        "items_exact": exact,
    }


def _text_recall(gt_cells: list[str], lines: list[str]) -> float:
    """合成图文字被本地 OCR 读到的比例（ground-truth 单元格 → OCR 全文去空白包含）。"""
    if not gt_cells or not lines:
        return 0.0
    blob = "".join(lines).replace(" ", "").replace("\u3000", "").replace("\t", "")
    hit = sum(1 for c in gt_cells if c and c.replace(" ", "").replace("\u3000", "") in blob)
    return round(hit / len([c for c in gt_cells if c]), 4)


def _eval_delivery(gt: dict, lines: list[str], boxes: list) -> dict:
    """本地解析链评测：标准版式走 parse_delivery，新格式走 parse_delivery_generic。"""
    from app.services.ocr.generic_parser import parse_delivery_generic
    from app.services.ocr.template import parse_delivery

    parsed_code = parse_delivery(lines) if lines else None
    parsed_generic = parse_delivery_generic(lines, boxes) if lines else None
    if gt.get("style") == "code":
        parsed = parsed_code if (parsed_code and parsed_code.get("items")) else parsed_generic
    else:
        parsed = parsed_generic if (parsed_generic and parsed_generic.get("items")) else parsed_code
    if not parsed:
        return {
            "engine": "none", "supplier_ok": False, "bill_no_ok": False,
            "text_recall": _text_recall(gt.get("cells") or [], lines),
            **_compare_items(gt.get("items") or [], []),
        }
    sup_ok = (parsed.get("supplier_name") or "").strip() == (gt.get("supplier_name") or "").strip()
    bill_ok = (parsed.get("bill_no") or "").strip() == (gt.get("bill_no") or "").strip()
    return {
        "engine": parsed.get("_engine") or "generic",
        "supplier_ok": sup_ok, "bill_no_ok": bill_ok,
        "text_recall": _text_recall(gt.get("cells") or [], lines),
        **_compare_items(gt.get("items") or [], parsed.get("items") or []),
    }


# ============================ 模板训练 ============================


def _save_product_template(db, anchors: list[str], prod: dict, out: Path) -> dict:
    """商品模板入库（sys_config ocr.product_templates，同锚点替换 ai_train/auto，保留手动）。

    数据库不可用时降级写本地文件 --out/templates_product.json。
    """
    tpl = {
        "id": uuid.uuid4().hex[:8],
        "name": prod.get("product_name") or prod.get("spec") or "AI训练模板",
        "brand": prod.get("brand") or "",
        "product_name": prod.get("product_name") or "",
        "spec": prod.get("spec") or "",
        "anchors": anchors,
        "auto": True,
        "source": "ai_train",
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    if db is not None:
        from app.services.ocr.product_template import load_templates, save_templates

        templates = [t for t in load_templates(db) if not (t.get("anchors") == anchors and (t.get("auto") or t.get("source") == "ai_train"))]
        templates.append(tpl)
        save_templates(db, templates)
        return tpl
    # 本地文件降级：同锚点仅替换 ai_train 条目
    path = out / "templates_product.json"
    templates = []
    if path.is_file():
        try:
            templates = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            templates = []
    templates = [t for t in templates if not (t.get("anchors") == anchors and t.get("source") == "ai_train")]
    templates.append(tpl)
    path.write_text(json.dumps(templates, ensure_ascii=False, indent=1), encoding="utf-8")
    return tpl


# ============================ 流水线执行 ============================


def _sample_dir(out: Path, kind: str, seq: int) -> Path:
    d = out / kind / f"{seq:03d}_{uuid.uuid4().hex[:8]}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def _archive_delivery_sample(img_bytes: bytes, gt: dict, result: dict) -> None:
    """通过校验的合成送货单样本归档（供后续真实训练/回归；与真实归档目录分开）。"""
    try:
        day = datetime.now().strftime("%Y-%m-%d")
        d = ROOT / "data" / "ocr_training" / "送货单-合成" / day
        d.mkdir(parents=True, exist_ok=True)
        stem = f"{datetime.now().strftime('%H%M%S')}_{uuid.uuid4().hex[:8]}"
        (d / f"{stem}.png").write_bytes(img_bytes)
        _write_json(d / f"{stem}.json", {"gt": gt, "eval": result})
    except OSError as e:  # noqa: BLE001 归档失败不阻断
        print(f"AI_TRAIN: 合成样本归档失败: {e}")


def _run_delivery(args: argparse.Namespace, rng: random.Random, db) -> int:
    out = Path(args.out) / "送货单"
    out.mkdir(parents=True, exist_ok=True)
    vision, vision_note = _vision_client(db, args.vision) if args.vision != "off" else (None, "关闭")
    print(f"AI_TRAIN: 送货单合成训练 start count={args.count} engine={args.engine or '默认'} "
          f"vision={args.vision}({vision_note}) gen_bg={args.gen_bg} threshold={args.threshold}")
    texture = _gen_texture_bg(db, args.gen_model) if args.gen_bg else None

    samples: list[dict] = []
    t0 = time.time()
    for i in range(args.count):
        style = "code" if rng.random() < 0.5 else "generic"
        img, gt = _render_delivery(rng, style, texture)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        data = buf.getvalue()

        vision_obj = _annotate(vision, data, DELIVERY_VISION_PROMPT) if vision else None
        vision_metrics = _compare_items(gt.get("items") or [], (vision_obj or {}).get("items") or []) if vision_obj else {}
        vision_acc = vision_metrics.get("field_accuracy", 0.0)
        accept = vision_acc >= args.threshold if vision_obj else True  # 无识图时 ground-truth 自带，不拦截
        if vision_obj and not accept:
            print(f"AI_TRAIN:  样本{i} 识图校验未通过 field_acc={vision_acc}（剔除，不入训练集）")

        ocr = _local_ocr(args.engine, data)
        lines, boxes = ocr if ocr is not None else ([], [])
        result = _eval_delivery(gt, lines, boxes)
        result.update({
            "style": style, "accept": accept,
            "vision": {"note": vision_note, "annotated": bool(vision_obj),
                       "field_accuracy": round(vision_acc, 4)} if vision else None,
            "ocr_lines": len(lines),
        })
        d = _sample_dir(out, style, i + 1)
        (d / "img.png").write_bytes(data)
        _write_json(d / "gt.json", gt)
        _write_json(d / "vision.json", vision_obj or {"note": vision_note})
        _write_json(d / "ocr.json", {"lines": lines})
        _write_json(d / "result.json", result)
        if accept:
            _archive_delivery_sample(data, gt, result)
        samples.append(result)
        print(f"AI_TRAIN:  样本{i + 1} style={style} engine={result['engine']} "
              f"text_recall={result['text_recall']} supplier_ok={result['supplier_ok']} "
              f"bill_no_ok={result['bill_no_ok']} items={result['n_parsed']}/{result['n_gt']} "
              f"field_acc={result['field_accuracy']} accept={accept}")

    report = _aggregate(samples, {"count": args.count, "mode": "delivery", "elapsed_s": round(time.time() - t0, 1),
                                  "vision": vision_note, "threshold": args.threshold})
    _write_json(Path(args.out) / "report.json", report)
    print(f"AI_TRAIN: 完成 {report['accepted']}/{args.count} 样本入训练集，报告: {Path(args.out) / 'report.json'}")
    return 0


def _run_product(args: argparse.Namespace, rng: random.Random, db) -> int:
    from app.services.ocr.product_template import build_anchors

    out = Path(args.out) / "物品标签"
    out.mkdir(parents=True, exist_ok=True)
    vision, vision_note = _vision_client(db, args.vision) if args.vision != "off" else (None, "关闭")
    print(f"AI_TRAIN: 商品标签模板训练 start count={args.count} engine={args.engine or '默认'} "
          f"vision={args.vision}({vision_note}) db={'no-db' if db is None else 'ok'}")
    texture = _gen_texture_bg(db, args.gen_model) if args.gen_bg else None

    samples: list[dict] = []
    trained = 0
    for i in range(args.count):
        img, gt = _render_label(rng, texture)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        data = buf.getvalue()

        vision_obj = _annotate(vision, data, LABEL_VISION_PROMPT) if vision else None
        # 无识图时以 ground-truth 作为标注（合成数据自带），保证流水线可降级运行
        prod = vision_obj if vision_obj else {"brand": gt["brand"], "product_name": gt["product_name"], "spec": gt["spec"]}
        vf = _compare_items([gt], [prod]).get("field_accuracy", 0.0)
        accept = vf >= args.threshold

        ocr = _local_ocr(args.engine, data)
        lines = ocr[0] if ocr is not None else []
        blob = "".join(lines).replace(" ", "").replace("\u3000", "").replace("\t", "")
        anchors = build_anchors(prod)
        # 锚点必须能被本地 OCR 实际读到（模板匹配依赖本地 OCR 文本），否则模板无效
        unreadable = [a for a in anchors if a.replace(" ", "") not in blob]
        viable = accept and anchors and not unreadable

        sample = {
            "accept": accept, "vision_field_accuracy": round(vf, 4),
            "anchors": anchors, "unreadable_anchors": unreadable, "viable": viable,
            "ocr_lines": len(lines),
        }
        if viable:
            tpl = _save_product_template(db, anchors, prod, Path(args.out))
            trained += 1
            sample["template_id"] = tpl["id"]
            print(f"AI_TRAIN:  样本{i + 1} 模板已入库 id={tpl['id']} anchors={anchors}")
        else:
            reason = "识图校验未通过" if not accept else ("无有效锚点" if not anchors else f"锚点本地 OCR 读不到: {unreadable}")
            print(f"AI_TRAIN:  样本{i + 1} 跳过（{reason}）")

        d = _sample_dir(out, "label", i + 1)
        (d / "img.png").write_bytes(data)
        _write_json(d / "gt.json", gt)
        _write_json(d / "vision.json", vision_obj or {"note": vision_note})
        _write_json(d / "ocr.json", {"lines": lines})
        _write_json(d / "result.json", sample)
        samples.append(sample)

    report = {
        "mode": "product", "count": args.count, "trained": trained,
        "vision": vision_note, "db": "no-db" if db is None else "ok",
        "elapsed_s": 0.0,
        "samples": samples,
    }
    _write_json(Path(args.out) / "report.json", report)
    print(f"AI_TRAIN: 完成 生成模板 {trained}/{args.count}（入库/本地文件），报告: {Path(args.out) / 'report.json'}")
    return 0


def _aggregate(samples: list[dict], meta: dict) -> dict:
    n = len(samples) or 1
    return {
        **meta,
        "accepted": sum(1 for s in samples if s.get("accept")),
        "text_recall_avg": round(sum(s.get("text_recall", 0) for s in samples) / n, 4),
        "supplier_ok_rate": round(sum(1 for s in samples if s.get("supplier_ok")) / n, 4),
        "bill_no_ok_rate": round(sum(1 for s in samples if s.get("bill_no_ok")) / n, 4),
        "items_exact_rate": round(sum(s.get("items_exact", 0) for s in samples) / max(sum(s.get("n_gt", 0) for s in samples), 1), 4),
        "field_accuracy_avg": round(sum(s.get("field_accuracy", 0) for s in samples) / n, 4),
        "vision_field_accuracy_avg": round(sum((s.get("vision") or {}).get("field_accuracy", 0) for s in samples) / n, 4),
        "engine_dist": {e: sum(1 for s in samples if s.get("engine") == e) for e in sorted({s.get("engine") for s in samples})},
        "samples": samples,
    }


def _run_self_test(args: argparse.Namespace, rng: random.Random) -> int:
    """零外部依赖冒烟：渲染 3 张（标准/新格式送货单 + 商品标签）→ 本地 OCR → 本地解析。"""
    print("AI_TRAIN: self-test start（无外部 API、无数据库）")
    texture = None
    for style in ("code", "generic"):
        img, gt = _render_delivery(rng, style, texture)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        ocr = _local_ocr(args.engine, buf.getvalue())
        lines, boxes = ocr if ocr is not None else ([], [])
        res = _eval_delivery(gt, lines, boxes)
        print(f"AI_TRAIN:  self-test delivery[{style}] engine={res['engine']} text_recall={res['text_recall']} "
              f"supplier_ok={res['supplier_ok']} bill_no_ok={res['bill_no_ok']} items={res['n_parsed']}/{res['n_gt']} "
              f"field_acc={res['field_accuracy']} ocr_lines={len(lines)}")
    img, gt = _render_label(rng, texture)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    ocr = _local_ocr(args.engine, buf.getvalue())
    lines = ocr[0] if ocr is not None else []
    blob = "".join(lines).replace(" ", "").replace("\u3000", "").replace("\t", "")
    hit = [c for c in gt["cells"] if c in blob]
    print(f"AI_TRAIN:  self-test label cells_read={hit} ocr_lines={len(lines)}")
    print("AI_TRAIN: self-test ok")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="识图/生图模型辅助本地 OCR 模板训练（AI开发文档/AI赋能设计.md P9-⑪）")
    p.add_argument("--mode", choices=["delivery", "product", "self-test"], default="delivery")
    p.add_argument("--count", type=int, default=4, help="合成样本数（self-test 忽略）")
    p.add_argument("--engine", choices=["rapidocr", "paddle", "off"], default=None,
                   help="本地 OCR 引擎（默认取 .env OCR_ENGINE）")
    p.add_argument("--vision", choices=["siliconflow", "mm_llm", "off"], default="siliconflow",
                   help="识图模型（训练辅助）；off=跳过")
    p.add_argument("--gen-bg", action="store_true", help="调用生图模型生成纸张纹理背景（需已配置视觉模型 Key）")
    p.add_argument("--gen-model", default="Kwai-Kolors/Kolors", help="生图模型名")
    p.add_argument("--threshold", type=float, default=0.6, help="识图校验通过阈值（字段级准确率）")
    p.add_argument("--no-db", action="store_true", help="不连数据库（模板降级写本地文件）")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out", default=str(ROOT / "data" / "ocr_training" / "synthetic"), help="输出目录")
    args = p.parse_args()

    rng = random.Random(args.seed)
    if args.mode == "self-test":
        return _run_self_test(args, rng)
    db = None if args.no_db else _open_db()
    if args.mode == "delivery":
        return _run_delivery(args, rng, db)
    return _run_product(args, rng, db)


if __name__ == "__main__":
    sys.exit(main())
