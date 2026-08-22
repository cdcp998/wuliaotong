/** map 模块：Leaflet 地图基础组件（方案 §5.2/§7.1 MapView；cable 模块复用）。
 *
 * - 底图：后端瓦片代理 /map/tile/{source}/{z}/{x}/{y}（缓存优先，未命中抓在线源）
 * - 叠加层：线缆 GeoJSON / 故障点 / 标记点 / 路径（导航）
 * - 坐标：数据与接口一律 WGS84，仅本组件按源 coordinate_space 做显示层转换（共享 geo.ts）
 */
import { useEffect, useMemo } from "react";
import { GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Empty } from "antd";

import { fromDisplaySpace, toDisplaySpace, type LatLng } from "@wlt/shared";

import type { CableItem, FaultItem, MarkerItem } from "../cable/api";
import { mapApi, type MapSourceInfo } from "./api";

/** 业务叠加层数据集合。 */
export interface MapOverlayData {
  cables: CableItem[];
  faults: FaultItem[];
  /** cable_id → 标记点 */
  markersByCable: Record<number, MarkerItem[]>;
  /** 设备地图标记（device 模块；无坐标的设备自动跳过） */
  devices?: { id: number; lat: number | null; lng: number | null; name: string; status: number }[];
}

interface MapViewProps {
  /** 地图源（缺省 esri）；coordinate_space 决定显示层坐标转换 */
  sources?: Record<string, MapSourceInfo>;
  sourceKey?: string;
  overlays?: MapOverlayData;
  /** 高点亮（测距结果等）[lat, lng] WGS84 */
  highlight?: LatLng | null;
  /** 导航路径 [lat, lng][] WGS84 */
  navPath?: LatLng[] | null;
  /** 草稿预览线（新增线缆选点自动连线：蓝色实线 + 绿起点/橙终点标记 + 自动 fit） */
  previewPath?: LatLng[] | null;
  /** 地图点击回调（已转换为 WGS84 lat/lng） */
  onPick?: (lat: number, lng: number) => void;
  /** 初始中心 [lat, lng] 与缩放 */
  center?: LatLng;
  zoom?: number;
  height?: number | string;
  /** 选取模式（地图点击取点提示） */
  picking?: string;
}

/** 未知图标修复：Leaflet 默认 Marker 图标在打包器下 404。 */
const defaultIcon = L.divIcon({
  className: "wlt-map-marker",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#5B7FFF;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const navIcon = L.divIcon({
  className: "wlt-map-marker",
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#EF4444;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const deviceIcon = L.divIcon({
  className: "wlt-map-marker",
  html: '<div style="width:13px;height:13px;border-radius:3px;background:#7C3AED;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [13, 13],
  iconAnchor: [6, 6],
});

const startIcon = L.divIcon({
  className: "wlt-map-marker",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#22C55E;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const endIcon = L.divIcon({
  className: "wlt-map-marker",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#F59E0B;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function ClickCatcher({ onPick, space }: { onPick?: (lat: number, lng: number) => void; space: string }) {
  useMapEvents({
    click(e) {
      if (!onPick) return;
      const [lng, lat] = fromDisplaySpace(e.latlng.lng, e.latlng.lat, space);
      onPick(lat, lng);
    },
  });
  return null;
}

function FitCables({ cables, previewPath }: { cables: CableItem[]; previewPath?: LatLng[] | null }) {
  const map = useMap();
  useEffect(() => {
    const pts: L.LatLngTuple[] = [];
    for (const c of cables) {
      for (const [lng, lat] of c.geometry?.coordinates ?? []) pts.push([lat, lng]);
    }
    for (const [lat, lng] of previewPath ?? []) pts.push([lat, lng]);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }, [cables, previewPath, map]);
  return null;
}

/** 地图底图瓦片 SourcePicker：默认使用第一个启用的源。 */
function BaseTile({ sources, sourceKey }: { sources: Record<string, MapSourceInfo>; sourceKey?: string }) {
  const key = sourceKey && sources[sourceKey]?.enabled ? sourceKey : Object.keys(sources).find((k) => sources[k]?.enabled);
  if (!key) return null;
  const url = mapApi.tileUrl(key, "{z}", "{x}", "{y}");
  return <TileLayer key={key} url={url} maxZoom={19} attribution="© 卫星影像" />;
}

/** 右下角信息条：当前图源名称（attribution 上方）。 */
function SourceInfoBadge({ sourceName }: { sourceName: string }) {
  return (
    <div style={{ position: "absolute", right: 50, bottom: 16, zIndex: 1000, pointerEvents: "none" }}>
      <span style={{ background: "rgba(255,255,255,.85)", padding: "2px 8px", borderRadius: 4, fontSize: 11, color: "#555", boxShadow: "0 1px 4px rgba(0,0,0,.12)" }}>
        图源：{sourceName}
      </span>
    </div>
  );
}

export function MapView({
  sources = {},
  sourceKey,
  overlays = { cables: [], faults: [], markersByCable: {} },
  highlight = null,
  navPath = null,
  previewPath = null,
  onPick,
  center = [30.2741, 120.1551],
  zoom = 12,
  height = "100%",
  picking,
}: MapViewProps) {
  const space = (sourceKey && sources[sourceKey]?.coordinate_space) || (Object.values(sources).find((s) => s.enabled)?.coordinate_space) || "wgs84";
  // 当前底图源（与 BaseTile 选择逻辑一致）：源名显示在右下角 attribution 上方
  const activeKey = sourceKey && sources[sourceKey]?.enabled ? sourceKey : Object.keys(sources).find((k) => sources[k]?.enabled);
  const sourceName = activeKey ? (sources[activeKey]?.name ?? activeKey) : "卫星影像";

  const cableGeojson = useMemo(() => {
    const feats = overlays.cables
      .filter((c) => c.geometry)
      .map((c) => ({
        type: "Feature",
        properties: { name: c.name, code: c.code, total_length: c.total_length },
        geometry: c.geometry,
      }));
    return { type: "FeatureCollection", features: feats } as GeoJSON.FeatureCollection;
  }, [overlays.cables]);

  const faultPoints = useMemo(
    () => overlays.faults.map((f) => ({ lat: f.lat, lng: f.lng, f })),
    [overlays.faults],
  );
  const markerPoints = useMemo(
    () =>
      Object.entries(overlays.markersByCable).flatMap(([cableId, ms]) =>
        ms.map((m) => ({ lat: m.lat, lng: m.lng, m, cableId })),
      ),
    [overlays.markersByCable],
  );
  const devicePoints = useMemo(
    () => (overlays.devices ?? []).filter((d) => d.lat != null && d.lng != null),
    [overlays.devices],
  );

  if (!Object.keys(sources).length) {
    return <Empty style={{ marginTop: 80 }} description="未配置地图源（系统管理 → 安装模块 → cable 模块配置）" />;
  }

  return (
    <div style={{ height, width: "100%", position: "relative" }}>
      {picking && (
        <div style={{ position: "absolute", zIndex: 1000, top: 8, left: 50, background: "#fff", padding: "6px 12px", borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,.15)" }}>
          {picking}
        </div>
      )}
      <MapContainer
        center={space === "wgs84" ? center : toDisplaySpace(center[1], center[0], space).reverse() as L.LatLngTuple}
        zoom={zoom}
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <ZoomControl position="bottomright" />
        <BaseTile sources={sources} sourceKey={sourceKey} />
        <ClickCatcher onPick={onPick} space={space} />
        <FitCables cables={overlays.cables} previewPath={previewPath} />
        <SourceInfoBadge sourceName={sourceName} />
        {cableGeojson.features.length > 0 && (
          <GeoJSON
            key={JSON.stringify(cableGeojson.features.map((f) => f.properties?.code))}
            data={cableGeojson}
            style={{ color: "#5B7FFF", weight: 4 }}
          />
        )}
        {faultPoints.map(({ lat, lng, f }) => {
          const [dlng, dlat] = toDisplaySpace(lng, lat, space);
          return (
            <Marker key={`f${f.id}`} position={[dlat, dlng]} icon={defaultIcon}>
              <Popup>
                <div>
                  <b>故障 #{f.id}</b>
                  <div>{f.fault_type || "未分类"}（{["低", "中", "高"][f.severity - 1] ?? f.severity}）</div>
                  <div>{f.description || "—"}</div>
                  <div>状态：{["待处理", "处理中", "待验证", "已修复", "已关闭"][f.status] ?? f.status}</div>
                </div>
              </Popup>
            </Marker>
          );
        })}
        {markerPoints.map(({ lat, lng, m }) => {
          const [dlng, dlat] = toDisplaySpace(lng, lat, space);
          return (
            <Marker key={`m${m.id}`} position={[dlat, dlng]} icon={defaultIcon}>
              <Popup>
                <div>
                  <b>{m.label || m.marker_type || "标记点"}</b>
                  <div>累计 {m.cumulative_distance.toFixed(1)} m</div>
                  {m.remark && <div>{m.remark}</div>}
                </div>
              </Popup>
            </Marker>
          );
        })}
        {devicePoints.map((d) => {
          const [dlng, dlat] = toDisplaySpace(d.lng!, d.lat!, space);
          return (
            <Marker key={`dev${d.id}`} position={[dlat, dlng]} icon={deviceIcon}>
              <Popup>
                <div>
                  <b>{d.name}</b>
                  <div>{["", "在用", "维修中", "闲置", "报废"][d.status] ?? d.status}</div>
                </div>
              </Popup>
            </Marker>
          );
        })}
        {highlight && (
          <Marker position={toDisplaySpace(highlight[1], highlight[0], space).reverse() as L.LatLngTuple} icon={navIcon}>
            <Popup>
              <div>
                定位点 {highlight[0].toFixed(6)}, {highlight[1].toFixed(6)}
              </div>
            </Popup>
          </Marker>
        )}
        {navPath && navPath.length > 1 && (
          <Polyline positions={navPath.map(([lat, lng]) => toDisplaySpace(lng, lat, space).reverse() as L.LatLngTuple)} pathOptions={{ color: "#EF4444", weight: 5, dashArray: "8 6" }} />
        )}
        {/* 草稿预览线：已选点自动连线（蓝实线 + 起点绿/终点橙） */}
        {previewPath && previewPath.length >= 2 && (
          <>
            <Polyline
              positions={previewPath.map(([lat, lng]) => toDisplaySpace(lng, lat, space).reverse() as L.LatLngTuple)}
              pathOptions={{ color: "#13c2c2", weight: 5, opacity: 0.9 }}
            />
            {(() => {
              const start = toDisplaySpace(previewPath[0][1], previewPath[0][0], space).reverse() as L.LatLngTuple;
              return <Marker position={start} icon={startIcon} />;
            })()}
            {(() => {
              const end = previewPath[previewPath.length - 1];
              const pos = toDisplaySpace(end[1], end[0], space).reverse() as L.LatLngTuple;
              return <Marker position={pos} icon={endIcon} />;
            })()}
          </>
        )}
      </MapContainer>
    </div>
  );
}
