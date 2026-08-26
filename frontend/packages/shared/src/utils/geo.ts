/** 地理计算工具（线缆和设备插件方案 §7.1 / §9.1/§9.4 前端侧）。
 *
 * 约定：业务数据存储与后端接口一律 WGS84（EPSG:4326）；本文件只在**显示层**按地图源
 * coordinate_space 做 WGS84↔GCJ-02/BD-09 转换（方案 §5.3），后端不参与业务几何显示转换。
 * 权威计算（长度/累计距离/投影）由后端 geo_math 完成，前端 Turf 式函数仅做交互预览，
 * 算法与后端保持一致（R = 6371008.8）。
 */

export const EARTH_RADIUS = 6371008.8; // 与后端/turf 一致

export type LngLat = [number, number]; // [lng, lat]
export type LatLng = [number, number]; // [lat, lng]

/** 两点球面距离（米）。 */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 逐点累计距离（米）。points: [lat, lng][] */
export function cumulativeDistances(points: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
  }
  return out;
}

/** 按目标累计距离（米）插值出线上点（[lat, lng]）。 */
export function interpolateByDistance(points: LatLng[], dists: number[], target: number): LatLng {
  if (!points.length) throw new Error("points 为空");
  if (target <= 0) return points[0];
  if (target >= dists[dists.length - 1]) return points[points.length - 1];
  for (let i = 1; i < points.length; i++) {
    if (dists[i] >= target) {
      const seg = dists[i] - dists[i - 1];
      if (seg <= 0) return points[i];
      const t = (target - dists[i - 1]) / seg;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    }
  }
  return points[points.length - 1];
}

/** 点 p 到线段 ab 的投影（[lat,lng] 输入，局部平面近似）：返回 { point, t, distance }。 */
export function projectPointToLine(
  p: LatLng,
  a: LatLng,
  b: LatLng,
): { point: LatLng; t: number; distance: number } {
  const mPerDegLat = 111319.49;
  const mPerDegLng = mPerDegLat * Math.cos(((p[0] + b[0]) / 2) * (Math.PI / 180));
  const toXY = ([lat, lng]: LatLng): [number, number] => [lng * mPerDegLng, lat * mPerDegLat];
  const [px, py] = toXY(p);
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const [projX, projY] = [ax + t * dx, ay + t * dy];
  return {
    point: [projY / mPerDegLat, projX / mPerDegLng],
    t,
    distance: Math.hypot(px - projX, py - projY),
  };
}

/** 点 p 投影到折线：返回 { point, cumulativeDistance }（米）。 */
export function projectToPolyline(points: LatLng[], p: LatLng): { point: LatLng; cumulativeDistance: number } {
  if (!points.length) throw new Error("points 为空");
  if (points.length === 1) return { point: points[0], cumulativeDistance: 0 };
  const dists = cumulativeDistances(points);
  let best = points[0];
  let bestCum = 0;
  let bestD = Infinity;
  for (let i = 1; i < points.length; i++) {
    const r = projectPointToLine(p, points[i - 1], points[i]);
    if (r.distance < bestD) {
      bestD = r.distance;
      best = r.point;
      bestCum = dists[i - 1] + haversine(points[i - 1][0], points[i - 1][1], best[0], best[1]);
    }
  }
  return { point: best, cumulativeDistance: bestCum };
}

/** 两点航向角（度，0=北，顺时针）。 */
export function bearing(p1: LatLng, p2: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const phi1 = rad(p1[0]);
  const phi2 = rad(p2[0]);
  const dLng = rad(p2[1] - p1[1]);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI < 0 ? (Math.atan2(y, x) * 180) / Math.PI + 360 : (Math.atan2(y, x) * 180) / Math.PI;
}

/** 两航向夹角（0-180 度）。 */
export function headingDiff(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d <= 180 ? d : 360 - d;
}

// ============================ 坐标系转换（仅显示层） ============================
// 算法为公开的 WGS84↔GCJ-02↔BD-09 近似；精度满足地图显示层需求（方案 §13.6）。

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/** WGS84 → GCJ-02（火星坐标，高德/腾讯）。 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

/** GCJ-02 → WGS84（近似迭代校正）。 */
export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  const [glng, glat] = wgs84ToGcj02(lng, lat);
  return [lng * 2 - glng, lat * 2 - glat];
}

const X_PI = (PI * 3000.0) / 180.0;

/** GCJ-02 → BD-09（百度）。 */
export function gcj02ToBd09(lng: number, lat: number): [number, number] {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006];
}

/** BD-09 → GCJ-02。 */
export function bd09ToGcj02(lng: number, lat: number): [number, number] {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

/** WGS84 → BD-09。 */
export function wgs84ToBd09(lng: number, lat: number): [number, number] {
  const [glng, glat] = wgs84ToGcj02(lng, lat);
  return gcj02ToBd09(glng, glat);
}

/** BD-09 → WGS84。 */
export function bd09ToWgs84(lng: number, lat: number): [number, number] {
  const [glng, glat] = bd09ToGcj02(lng, lat);
  return gcj02ToWgs84(glng, glat);
}

/**
 * 按地图源坐标空间把 WGS84 坐标转换到显示坐标（显示层专用；入库/接口仍为 WGS84）。
 * space: wgs84 | gcj02 | bd09
 */
export function toDisplaySpace(lng: number, lat: number, space: string): [number, number] {
  if (space === "gcj02") return wgs84ToGcj02(lng, lat);
  if (space === "bd09") return wgs84ToBd09(lng, lat);
  return [lng, lat];
}

/** 反向：显示坐标 → WGS84（地图点击取点时使用）。 */
export function fromDisplaySpace(lng: number, lat: number, space: string): [number, number] {
  if (space === "gcj02") return gcj02ToWgs84(lng, lat);
  if (space === "bd09") return bd09ToWgs84(lng, lat);
  return [lng, lat];
}

// ============================ 显示坐标系偏好（中国大陆 GCJ-02 加密显示） ============================

/** 默认显示坐标系：GCJ-02（对 WGS-84 业务坐标做加密偏移显示，适配中国大陆使用场景）。 */
export const DEFAULT_DISPLAY_SPACE = "gcj02";

/**
 * 解析当前生效的显示坐标系：
 * - 非 WGS84 底图源（gcj02/bd09，如高德/百度瓦片）按源原生空间对齐，避免二次偏移；
 * - WGS84 底图（如 Esri）按全局偏好显示；未设置时默认 GCJ-02（加密显示）。
 */
export function resolveDisplaySpace(
  sourceSpace: string | null | undefined,
  globalPref: string | null | undefined,
): string {
  if (sourceSpace && sourceSpace !== "wgs84") return sourceSpace;
  return globalPref || DEFAULT_DISPLAY_SPACE;
}

// ============================ 定位获取（含降级链） ============================

import { http } from "../api/client";

export interface AppPosition {
  lat: number;
  lng: number;
  accuracy?: number;
  /** gps=浏览器定位（WGS84）；ip=浏览器侧 IP 粗略定位；server=后端代理 IP 定位。均为 WGS84。 */
  source: "gps" | "ip" | "server";
}

/** 单个上游服务超时（毫秒）：总降级链最坏 ≈ gps 8s + 4×3s + 服务端 6s，典型 2~5s 内命中。 */
const PROVIDER_TIMEOUT_MS = 3000;
/** 非GPS粗定位的会话内缓存时长：避免每次点击都重走整条降级链等待。 */
const IP_FIX_TTL_MS = 10 * 60_000;

let _lastNonGpsFix: (AppPosition & { at: number }) | null = null;

function fetchJsonWithTimeout(url: string, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { cache: "no-store", signal: ctrl.signal })
    .then(async (resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return (await resp.json()) as Record<string, unknown>;
    })
    .finally(() => clearTimeout(timer));
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("no coords");
  return n;
}

/**
 * 获取当前位置（WGS84），带完整降级链。修复 iOS / HTTP 内网部署下无法定位：
 *
 * 1. 浏览器 Geolocation（仅 HTTPS/localhost 可用；iOS Safari 在 HTTP 页面直接不暴露）；
 * 2. 浏览器侧无键 HTTPS IP 服务 ×3（geojs.io → freeipapi.com → ipapi.co）；
 * 3. ip-api.com HTTP 版（页面本身是 HTTP 时可用；HTTPS 页面被混合内容拦截自动跳过）；
 * 4. 后端代理 GET /map/ip-locate（服务端发起查询，无 CORS/混合内容/可达性限制，最后兜底）。
 *
 * 全部失败才 reject（调用方提示手动选点）。非 GPS 粗定位结果会话内缓存 10 分钟。
 */
export function getCurrentPositionWithFallback(timeoutMs = 8000): Promise<AppPosition> {
  // 上次粗定位仍新鲜 → 秒回（避免重复等待整条链）
  if (_lastNonGpsFix && Date.now() - _lastNonGpsFix.at < IP_FIX_TTL_MS) {
    return Promise.resolve(_lastNonGpsFix);
  }

  const viaBrowser = (): Promise<AppPosition> =>
    new Promise((resolve, reject) => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator) || !navigator.geolocation) {
        reject(new Error("geolocation unavailable"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined, source: "gps" }),
        (err) => reject(new Error(`geolocation error ${err.code}`)),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
      );
    });

  const viaGeojs = async (): Promise<AppPosition> => {
    const j = await fetchJsonWithTimeout("https://get.geojs.io/v1/ip/geo.json");
    return { lat: num(j.latitude), lng: num(j.longitude), source: "ip" };
  };
  const viaFreeIpApi = async (): Promise<AppPosition> => {
    const j = await fetchJsonWithTimeout("https://freeipapi.com/api/json");
    return { lat: num(j.latitude), lng: num(j.longitude), source: "ip" };
  };
  const viaIpapiCo = async (): Promise<AppPosition> => {
    const j = await fetchJsonWithTimeout("https://ipapi.co/json/");
    return { lat: num(j.latitude), lng: num(j.longitude), source: "ip" };
  };
  // 免费版 ip-api 仅支持 HTTP：HTTP 页面可用（本系统典型部署形态）；HTTPS 页面会因混合内容被拦，异常后自然跳过
  const viaIpApiCom = async (): Promise<AppPosition> => {
    const j = await fetchJsonWithTimeout("http://ip-api.com/json/?fields=status,lat,lon");
    if (j.status !== "success") throw new Error("ip-api failed");
    return { lat: num(j.lat), lng: num(j.lon), source: "ip" };
  };
  // 最后兜底：后端代理查询（服务端网络环境通常与浏览器不同，且不受任何浏览器限制）
  const viaServerProxy = async (): Promise<AppPosition> => {
    const r = await http.get<{ lat: number; lng: number }>("/map/ip-locate", 6000);
    return { lat: num(r.lat), lng: num(r.lng), source: "server" };
  };

  const chain: (() => Promise<AppPosition>)[] = [
    viaBrowser,
    viaGeojs,
    viaFreeIpApi,
    viaIpapiCo,
    viaIpApiCom,
    viaServerProxy,
  ];

  const tryNext = async (idx: number): Promise<AppPosition> => {
    if (idx >= chain.length) throw new Error("所有定位方式均失败");
    try {
      const pos = await chain[idx]();
      if (pos.source !== "gps") _lastNonGpsFix = { ...pos, at: Date.now() };
      else _lastNonGpsFix = null; // 有精确 GPS 后使缓存的粗定位失效
      return pos;
    } catch {
      return tryNext(idx + 1);
    }
  };
  return tryNext(0);
}
