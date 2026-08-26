/** map 模块：Leaflet 地图基础组件（方案 §5.2/§7.1 MapView；cable 模块复用）。
 *
 * - 底图：后端瓦片代理 /map/tile/{source}/{z}/{x}/{y}（缓存优先，未命中抓在线源）
 * - 叠加层：线缆 GeoJSON / 故障点 / 标记点 / 路径（导航）/ 我的位置 / 画线（工作台）
 * - 坐标：数据与接口一律 WGS84，仅本组件做显示层转换：非 WGS84 底图按源原生空间对齐，
 *   WGS84 底图按全局偏好显示（默认 GCJ-02 加密显示，中国大陆场景）——共享 geo.ts
 */
import { useEffect, useMemo } from "react";
import { GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { fromDisplaySpace, resolveDisplaySpace, toDisplaySpace, type LatLng } from "@wlt/shared";

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

/** 画线功能：用户绘制的线条（WGS84 点列）。 */
export interface DrawnLine {
  id: number | string;
  points: LatLng[];
  color?: string;
}

interface MapViewProps {
  /** 地图源（缺省 esri）；coordinate_space 参与显示层坐标转换 */
  sources?: Record<string, MapSourceInfo>;
  sourceKey?: string;
  overlays?: MapOverlayData;
  /** 高亮点（测距结果等）[lat, lng] WGS84 */
  highlight?: LatLng | null;
  /** 导航路径 [lat, lng][] WGS84 */
  navPath?: LatLng[] | null;
  /** 草稿预览线（新增线缆选点自动连线：蓝色实线 + 绿起点/橙终点标记 + 自动 fit） */
  previewPath?: LatLng[] | null;
  /** 我的当前位置 [lat, lng] WGS84（蓝色定位标识点，随浏览器/IP 定位更新） */
  myPosition?: LatLng | null;
  /** 画线：已完成的线条列表 */
  extraLines?: DrawnLine[];
  /** 画线：正在绘制中的草稿点列（虚线预览，不参与 fitBounds） */
  draftLine?: LatLng[] | null;
  /** 全局显示坐标系偏好（地图缓存管理设置；缺省按源空间 → 默认 GCJ-02） */
  displaySpace?: string | null;
  /** 地图点击回调（已转换为 WGS84 lat/lng） */
  onPick?: (lat: number, lng: number) => void;
  /** 初始中心 [lat, lng] 与缩放 */
  center?: LatLng;
  zoom?: number;
  height?: number | string;
  /** 选取模式（地图点击取点提示） */
  picking?: string;
  /** 地图实例就绪回调（父组件渲染自定义浮层控件：缩放/指北等）；卸载时回调 null */
  onMapReady?: (map: L.Map | null) => void;
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

/** 我的位置：蓝色定位标识点（外圈光晕 + 内芯）。 */
const myLocationIcon = L.divIcon({
  className: "wlt-map-marker",
  html:
    '<div style="position:relative;width:22px;height:22px">' +
    '<span style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,.30)"></span>' +
    '<span style="position:absolute;left:5px;top:5px;width:12px;height:12px;border-radius:50%;background:#3B82F6;border:2px solid #fff;box-shadow:0 0 6px rgba(37,99,235,.8)"></span>' +
    "</div>",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
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

/** 把 Leaflet map 实例回传给父组件（自定义浮层缩放/指北控件用）。 */
function MapHandle({ onMapReady }: { onMapReady?: (map: L.Map | null) => void }) {
  const map = useMap();
  useEffect(() => {
    onMapReady?.(map);
    return () => onMapReady?.(null);
  }, [map, onMapReady]);
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

export function MapView({
  sources = {},
  sourceKey,
  overlays = { cables: [], faults: [], markersByCable: {} },
  highlight = null,
  navPath = null,
  previewPath = null,
  myPosition = null,
  extraLines = [],
  draftLine = null,
  displaySpace = null,
  onPick,
  center = [30.2741, 120.1551],
  zoom = 12,
  height = "100%",
  picking,
  onMapReady,
}: MapViewProps) {
  const srcSpace =
    (sourceKey && sources[sourceKey]?.coordinate_space) || Object.values(sources).find((s) => s.enabled)?.coordinate_space;
  // 显示坐标系：非 WGS84 底图按源空间对齐；WGS84 底图按全局偏好（默认 GCJ-02 加密显示）
  const space = resolveDisplaySpace(srcSpace, displaySpace);
  const hasSources = Object.keys(sources).length > 0;

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

  // 无图源时不再整体替换为 Empty（那会连标记点/定位点一起隐藏）：
  // 地图仍渲染，仅给出底图不可用提示，保证叠加数据始终可见。
  return (
    <div style={{ height, width: "100%", position: "relative" }}>
      {!hasSources && (
        <div style={{ position: "absolute", zIndex: 900, top: 8, left: 8, background: "rgba(255,255,255,.92)", padding: "5px 10px", borderRadius: 8, fontSize: 12, color: "#5B6478", boxShadow: "0 1px 6px rgba(0,0,0,.12)" }}>
          未配置可用地图源：底图不可用（标记点仍正常显示）
        </div>
      )}
      {picking && (
        <div style={{ position: "absolute", zIndex: 1000, top: 8, left: 50, background: "#fff", padding: "6px 12px", borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,.15)" }}>
          {picking}
        </div>
      )}
      <MapContainer
        center={space === "wgs84" ? center : toDisplaySpace(center[1], center[0], space).reverse() as L.LatLngTuple}
        zoom={zoom}
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <MapHandle onMapReady={onMapReady} />
        <BaseTile sources={sources} sourceKey={sourceKey} />
        <ClickCatcher onPick={onPick} space={space} />
        <FitCables cables={overlays.cables} previewPath={previewPath} />
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
        {/* 画线：已完成线条（青绿实线） */}
        {extraLines.map((line) =>
          line.points.length >= 2 ? (
            <Polyline
              key={`line${line.id}`}
              positions={line.points.map(([lat, lng]) => toDisplaySpace(lng, lat, space).reverse() as L.LatLngTuple)}
              pathOptions={{ color: line.color ?? "#0D9488", weight: 4, opacity: 0.95 }}
            />
          ) : null,
        )}
        {/* 画线：绘制中草稿（虚线 + 已落节点小圆点），不触发 fitBounds */}
        {draftLine && draftLine.length > 0 && (
          <>
            {draftLine.length >= 2 && (
              <Polyline
                positions={draftLine.map(([lat, lng]) => toDisplaySpace(lng, lat, space).reverse() as L.LatLngTuple)}
                pathOptions={{ color: "#0D9488", weight: 3, opacity: 0.8, dashArray: "6 6" }}
              />
            )}
            {draftLine.map(([lat, lng], i) => {
              const [dlng, dlat] = toDisplaySpace(lng, lat, space);
              return (
                <Marker
                  key={`dnode${i}`}
                  position={[dlat, dlng]}
                  icon={L.divIcon({
                    className: "wlt-map-marker",
                    html: '<div style="width:8px;height:8px;border-radius:50%;background:#0D9488;border:1px solid #fff"></div>',
                    iconSize: [8, 8],
                    iconAnchor: [4, 4],
                  })}
                />
              );
            })}
          </>
        )}
        {/* 我的位置：蓝色定位标识点（GPS/IP 定位结果，WGS84 → 显示坐标系转换后渲染） */}
        {myPosition && (
          <Marker
            position={toDisplaySpace(myPosition[1], myPosition[0], space).reverse() as L.LatLngTuple}
            icon={myLocationIcon}
            zIndexOffset={1000}
          >
            <Popup>
              <div>
                <b>我的位置</b>
                <div>{myPosition[0].toFixed(6)}, {myPosition[1].toFixed(6)}（WGS84）</div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
