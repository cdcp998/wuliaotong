"""完成工作照片水印：下载/预览时动态绘制（原始照片不保存水印）。

位置：watermark.position 配置，取值 bottom / top / bottom-left / bottom-right / top-left / top-right。
模板：watermark.template 配置，占位符 {location} 使用地点 / {time} 完成时间 / {gps} 定位坐标。
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

WATERMARK_DEFAULT_TEMPLATE = "地点：{location}｜时间：{time}｜坐标：{gps}"
WATERMARK_POSITIONS = ("bottom", "top", "bottom-left", "bottom-right", "top-left", "top-right")
WATERMARK_DEFAULT_POSITION = "bottom"


def load_font(size: int = 26):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def render_template(template: str, location: str, time: str, gps: str) -> str:
    """水印文案：模板占位符 {location} / {time} / {gps}；模板非法时回退默认模板。"""
    try:
        return template.format(location=location, time=time, gps=gps)
    except (KeyError, IndexError, ValueError):
        return WATERMARK_DEFAULT_TEMPLATE.format(location=location, time=time, gps=gps)


def render_watermark(
    img: Image.Image,
    text: str,
    position: str = WATERMARK_DEFAULT_POSITION,
    bg_opaque: bool = True,
) -> Image.Image:
    """在图片上绘制水印（底部/顶部通栏，或四角），返回新图（原图不变）。

    bg_opaque=True：黑色不透明底 + 白字；False：透明背景（仅白字黑描边，不遮挡照片）。
    """
    img = img.convert("RGB")
    draw = ImageDraw.Draw(img)
    font = load_font(26)
    w, h = img.size
    max_w = w - 80
    # 按宽度自动换行
    lines: list[str] = []
    cur = ""
    for ch in text:
        if cur and draw.textlength(cur + ch, font=font) > max_w:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    if not lines:
        return img

    line_h = 36
    box_w = min(w, int(max(draw.textlength(x, font=font) for x in lines)) + 40)
    box_h = len(lines) * line_h + 14
    if position in ("top", "top-left", "top-right"):
        y0 = 0
    else:  # bottom 系列（默认）
        y0 = h - box_h
    if position in ("bottom-left", "top-left"):
        x0 = 0
    elif position in ("bottom-right", "top-right"):
        x0 = w - box_w
    else:  # center
        x0 = (w - box_w) // 2

    if bg_opaque:
        draw.rectangle([x0, y0, x0 + box_w, y0 + box_h], fill=(0, 0, 0))
    y = y0 + 8
    for line in lines:
        draw.text((x0 + 20, y), line, font=font, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
        y += line_h
    return img


def sample_preview_image(size: tuple[int, int] = (640, 400)) -> Image.Image:
    """系统设置里的水印预览示例底图（纯色 + 示例字样，不依赖真实照片）。"""
    img = Image.new("RGB", size, (230, 236, 245))
    draw = ImageDraw.Draw(img)
    font = load_font(34)
    draw.rectangle([12, 12, size[0] - 12, size[1] - 12], outline=(150, 158, 172), width=2)
    t = "示例照片"
    tw = draw.textlength(t, font=font)
    draw.text(((size[0] - tw) / 2, (size[1] - 40) / 2), t, font=font, fill=(120, 130, 148))
    return img
