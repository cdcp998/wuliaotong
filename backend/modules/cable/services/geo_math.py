"""cable 模块：Geo 计算（Haversine / 累计距离 / 插值 / 投影，线缆和设备插件方案 §9.1）。

约定（方案 §5.3）：存储与后端计算一律 WGS84（EPSG:4326），前端显示层按地图源坐标空间转换；
权威计算在后端（geo_math），前端 Turf.js 仅做交互预览。
"""
from __future__ import annotations

import math

R = 6371008.8  # 地球平均半径（米），与 turf.js 一致


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点球面距离（米）。"""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def cumulative_distances(points: list[tuple[float, float]]) -> list[float]:
    """逐点累计距离（米），[0, d1, d1+d2, ...]。points = [(lat, lng), ...]。"""
    dists = [0.0]
    for i in range(1, len(points)):
        lat1, lng1 = points[i - 1]
        lat2, lng2 = points[i]
        dists.append(dists[-1] + haversine(lat1, lng1, lat2, lng2))
    return dists


def interpolate_by_distance(
    points: list[tuple[float, float]], dists: list[float], target: float
) -> tuple[float, float]:
    """按目标累计距离（米）插值出线上点坐标（线性插值，Web 墨卡托下误差可忽略；方案明确用球面距离标尺）。"""
    if not points:
        raise ValueError("points 为空")
    if target <= 0:
        return points[0]
    if target >= dists[-1]:
        return points[-1]
    for i in range(1, len(points)):
        if dists[i] >= target:
            seg = dists[i] - dists[i - 1]
            if seg <= 0:
                return points[i]
            t = (target - dists[i - 1]) / seg
            lat = points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t
            lng = points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t
            return lat, lng
    return points[-1]


def project_point_to_line(
    p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> tuple[float, float, float]:
    """点 p 到线段 ab 的投影：返回 (投影点, 权重 t∈[0,1], 垂距米)。局部平面近似（等距圆柱），
    足够用于 2km 内线缆投影（方案 §5.5 候选线缆选择）。"""
    lat_scale = math.cos(math.radians((p[0] + b[0]) / 2))
    # 转局部平面坐标（米）：1° 纬度 ≈ 111319.49m
    m_per_deg_lat = 111319.49
    m_per_deg_lng = m_per_deg_lat * lat_scale

    def to_xy(pt: tuple[float, float]) -> tuple[float, float]:
        return (pt[1] * m_per_deg_lng, pt[0] * m_per_deg_lat)

    px, py = to_xy(p)
    ax, ay = to_xy(a)
    bx, by = to_xy(b)
    dx, dy = bx - ax, by - ay
    seg_len2 = dx * dx + dy * dy
    if seg_len2 <= 0:
        t = 0.0
    else:
        t = ((px - ax) * dx + (py - ay) * dy) / seg_len2
        t = max(0.0, min(1.0, t))
    proj_x, proj_y = ax + t * dx, ay + t * dy
    proj_lng = proj_x / m_per_deg_lng
    proj_lat = proj_y / m_per_deg_lat
    dist = math.hypot(px - proj_x, py - proj_y)
    return proj_lat, proj_lng, dist


def project_to_polyline(
    points: list[tuple[float, float]], p: tuple[float, float]
) -> tuple[tuple[float, float], float]:
    """点 p 投影到折线：返回 (最近投影点, 投影点的累计距离米)。"""
    if not points:
        raise ValueError("points 为空")
    if len(points) == 1:
        return points[0], 0.0
    dists = cumulative_distances(points)
    best: tuple[tuple[float, float], float] | None = None
    best_d = float("inf")
    for i in range(1, len(points)):
        proj_lat, proj_lng, dist = project_point_to_line(p, points[i - 1], points[i])
        if dist < best_d:
            best_d = dist
            # 该段内投影按累计距离标尺插值（首端 + 段长 × t）
            seg = dists[i] - dists[i - 1]
            seg_d = haversine(points[i - 1][0], points[i - 1][1], proj_lat, proj_lng)
            cum = dists[i - 1] + min(seg_d, seg)
            best = ((proj_lat, proj_lng), cum)
    if best is None:
        return points[0], 0.0
    return best[0], best[1]


def remaining_distance(from_cum: float, to_cum: float) -> float:
    """沿线的剩余距离（米，绝对值）。"""
    return abs(to_cum - from_cum)


def bearing(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    """两点航向角（度，0=北，顺时针）。"""
    phi1, phi2 = math.radians(p1[0]), math.radians(p2[0])
    dlambda = math.radians(p2[1] - p1[1])
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def heading_diff(heading1: float, heading2: float) -> float:
    """两航向夹角（0-180 度）。"""
    diff = abs(heading1 - heading2) % 360.0
    return diff if diff <= 180.0 else 360.0 - diff
