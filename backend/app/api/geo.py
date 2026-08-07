"""逆地理编码：GPS 坐标 → 地址（OpenStreetMap Nominatim，免费无需 key；需外网）。

适用场景：完成工作照片没有原始 {location} 记录时，用 GPS 坐标反查地址补全水印/记录。
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, Query

from app.core.deps import get_current_user
from app.core.response import BizError, E_PARAM, ok

router = APIRouter(tags=["地理"], dependencies=[Depends(get_current_user)])

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"


@router.get("/geo/reverse")
def geo_reverse(
    lat: float = Query(..., ge=-90, le=90, description="纬度"),
    lng: float = Query(..., ge=-180, le=180, description="经度"),
) -> dict:
    """GPS 坐标反查地址（OpenStreetMap，中文优先）；失败返回可读错误。"""
    params = urllib.parse.urlencode({
        "format": "jsonv2",
        "lat": f"{lat:.6f}",
        "lon": f"{lng:.6f}",
        "accept-language": "zh-CN",
    })
    req = urllib.request.Request(
        f"{_NOMINATIM_URL}?{params}",
        headers={"User-Agent": "wuliaotong-wms/1.0 (internal)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        raise BizError(E_PARAM, "逆地理编码失败：无法访问 OpenStreetMap（需外网），请手动填写地址")
    if not data or "display_name" not in data:
        raise BizError(E_PARAM, "该坐标附近未查询到地址，请手动填写")
    address = data.get("address") or {}
    parts = [address.get(k) for k in ("country", "state", "province", "city", "district", "town", "village", "suburb", "neighbourhood", "road", "house_number", "shop", "building", "amenity", "industrial", "office") if address.get(k)]
    short = "，".join(dict.fromkeys(parts)) or data.get("display_name", "")
    return ok({
        "address": data.get("display_name", ""),
        "short_address": short,
    })
