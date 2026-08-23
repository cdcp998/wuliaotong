/** map 模块：地图工作台（/cable/map，cable:view）——《UI设计交付文档.md》设计页 46 落地。
 *
 * v3 界面（OpenPencil 设计稿全工作区化）：
 * - 无页头、无内边距：顶栏以下整块为地图工作区（底图 #DDE7F5）
 * - 左上 图源 pill（点击切换底图）｜右上 玻璃工具栏（位置/测距/图层/刷新/标记，激活=品牌色）
 * - 图层下拉（线缆/故障/设备/标记 点击行开关，激活浅底）挂在工具栏下方
 * - 左下 故障导航 pill（点击展开导航浮层）+ 图例 pill；右下 缩放(+/-) + 指北回正
 * - 测距定位为工具栏展开的玻璃浮层卡（线缆选择 + 距离 + 结果）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Descriptions, Dropdown, InputNumber, Select, Tooltip } from "antd";
import { AimOutlined, AppstoreOutlined, CompassOutlined, DownOutlined, EnvironmentOutlined, GlobalOutlined, MinusOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import L from "leaflet";

import type { LatLng } from "@wlt/shared";

import { cableApi, type CableItem, type FaultItem, type MarkerItem, type MeasureResult, type NavigateResult } from "../cable/api";
import { mapApi, type MapSourceInfo } from "./api";
import { MapView } from "./MapView";

const TYPE_LABEL: Record<string, string> = { wire: "电线", fiber: "光缆", network: "网线" };
/** 地图初始视图（指北回正 / 无数据时的视图）。 */
const DEFAULT_VIEW: { center: LatLng; zoom: number } = { center: [30.2741, 120.1551], zoom: 12 };

/** 工具栏小按钮（设计稿：40px 图标 + 8.5px 文字，激活=品牌蓝）。 */
function ToolbarBtn({ active, tip, icon, label, onClick }: { active?: boolean; tip: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Tooltip title={tip} placement="bottom">
      <div
        onClick={onClick}
        style={{
          width: 40,
          padding: "4px 0",
          display: "flex",
          flexDirection: "column",
          gap: 1,
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          borderRadius: 10,
          color: active ? "#3B5BDB" : "#5B6478",
        }}
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: 8.5, fontWeight: active ? 700 : 400, lineHeight: 1.5 }}>{label}</span>
      </div>
    </Tooltip>
  );
}

export function MapWorkbenchPage() {
  const { message } = App.useApp();
  const [sources, setSources] = useState<Record<string, MapSourceInfo>>({});
  const [activeSource, setActiveSource] = useState<string>("");
  const [cables, setCables] = useState<CableItem[]>([]);
  const [faults, setFaults] = useState<FaultItem[]>([]);
  const [markersByCable, setMarkersByCable] = useState<Record<number, MarkerItem[]>>({});
  const [layers, setLayers] = useState({ cables: true, faults: true, markers: true, devices: true });
  const [devices, setDevices] = useState<{ id: number; lat: number | null; lng: number | null; name: string; status: number }[]>([]);
  const [selCable, setSelCable] = useState<number | undefined>();
  const [distance, setDistance] = useState<number | undefined>();
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  const [highlight, setHighlight] = useState<LatLng | null>(null);
  const [pickMode, setPickMode] = useState<"none" | "navStart">("none");
  const [navStart, setNavStart] = useState<LatLng | null>(null);
  const [navFault, setNavFault] = useState<number | undefined>();
  const [navResult, setNavResult] = useState<NavigateResult | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [navigating, setNavigating] = useState(false);
  // 浮层开关：图层下拉 / 测距卡 / 故障导航卡
  const [layersOpen, setLayersOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [map, setMap] = useState<L.Map | null>(null);

  const load = useCallback(async () => {
    try {
      const [src, cablesResp, faultsResp] = await Promise.all([
        mapApi.mapSources(),
        cableApi.listCables({ page_size: 100 }),
        cableApi.listFaults({ page_size: 100, exclude_closed: true }),
      ]);
      setSources(src.map_sources);
      setCables(cablesResp.items);
      setFaults(faultsResp.items);
      const byCable: Record<number, MarkerItem[]> = {};
      await Promise.all(
        cablesResp.items.slice(0, 30).map(async (c) => {
          try {
            byCable[c.id] = await cableApi.listMarkers(c.id);
          } catch {
            byCable[c.id] = [];
          }
        }),
      );
      setMarkersByCable(byCable);
      try {
        const dev = await import("../device/api");
        const devResp = await dev.deviceApi.list({ page_size: 200 });
        setDevices(devResp.items.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng, name: d.name, status: d.status })));
      } catch {
        setDevices([]);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载地图数据失败");
    }
  }, [message, activeSource]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const overlays = useMemo(
    () => {
      const base = {
        cables: layers.cables ? cables : [],
        faults: layers.faults ? faults : [],
        markersByCable: layers.markers ? markersByCable : {},
      };
      return layers.devices ? { ...base, devices } : base;
    },
    [cables, faults, markersByCable, devices, layers],
  );

  const doMeasure = async () => {
    if (!selCable || distance === undefined) {
      message.warning("请先选择线缆并输入目标距离");
      return;
    }
    setMeasuring(true);
    try {
      const r = await cableApi.measure({ cable_id: selCable, distance });
      setMeasureResult(r);
      setHighlight([r.lat, r.lng]);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "测距失败");
    } finally {
      setMeasuring(false);
    }
  };

  const locateMe = useCallback(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setNavStart([pos.coords.latitude, pos.coords.longitude]),
      () => message.warning("无法获取定位，请点击地图选择起点（进入「选起点」模式）"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [message]);

  const doNavigate = async () => {
    if (!navFault || !navStart) {
      message.warning("请选择故障点并设置起点（我的位置或地图选点）");
      return;
    }
    setNavigating(true);
    try {
      const r = await cableApi.navigate({ lat: navStart[0], lng: navStart[1], fault_id: navFault });
      setNavResult(r);
      if (r.projection) setHighlight([r.projection.lat, r.projection.lng]);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导航计算失败");
    } finally {
      setNavigating(false);
    }
  };

  /** 当前底图源显示名（与 MapView 选择逻辑一致）。 */
  const activeKey = activeSource && sources[activeSource]?.enabled ? activeSource : Object.keys(sources).find((k) => sources[k]?.enabled);
  const sourceName = activeKey ? (sources[activeKey]?.name ?? activeKey) : "卫星影像";
  const sourceItems = Object.entries(sources)
    .filter(([, v]) => v.enabled !== false)
    .map(([k, v]) => ({ key: k, label: v.name ?? k }));

  const markerCount = useMemo(() => Object.values(markersByCable).reduce((a, b) => a + b.length, 0), [markersByCable]);
  const layerRows: { key: keyof typeof layers; dot: string; dotRadius: number; label: string }[] = [
    { key: "cables", dot: "#5B7FFF", dotRadius: 4, label: `线缆层（${cables.length}）` },
    { key: "faults", dot: "#DC2626", dotRadius: 4, label: `故障层（${faults.length}）` },
    { key: "devices", dot: "#7C3AED", dotRadius: 1, label: `设备层（${devices.length}）` },
    { key: "markers", dot: "#22C55E", dotRadius: 4, label: `标记点层（${markerCount}）` },
  ];

  const navFaultItem = navFault === undefined ? undefined : faults.find((f) => f.id === navFault);

  /** 浮层玻璃卡通用样式（与设计稿一致的浅色玻璃）。 */
  const floatCard: React.CSSProperties = {
    position: "absolute",
    zIndex: 1000,
    background: "rgba(255,255,255,.96)",
    backdropFilter: "blur(10px)",
    border: "1px solid #E4EAF6",
    borderRadius: 14,
    boxShadow: "0 6px 24px rgba(30,36,51,.14)",
  };

  return (
    <div className="wlt-fill" style={{ position: "relative", overflow: "hidden", minHeight: 0, background: "#DDE7F5" }}>
      <MapView
        sources={sources}
        sourceKey={activeSource || undefined}
        overlays={overlays}
        highlight={highlight}
        navPath={navResult?.path ?? null}
        onMapReady={setMap}
        onPick={
          pickMode === "navStart"
            ? (lat, lng) => { setNavStart([lat, lng]); setPickMode("none"); setNavOpen(true); }
            : undefined
        }
        picking={pickMode === "navStart" ? "请在故障线路上点击选择导航起点（自动转换为 WGS84）" : undefined}
      />

      {/* 左上：图源 pill（点击切换底图） */}
      <Dropdown menu={{ items: sourceItems, selectable: true, selectedKeys: activeKey ? [activeKey] : [], onClick: ({ key }) => setActiveSource(key) }} placement="bottomLeft">
        <div style={{ ...floatCard, top: 14, left: 16, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999, cursor: "pointer" }}>
          <GlobalOutlined style={{ fontSize: 14, color: "#3B5BDB" }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: "#1E2433" }}>{sourceName}</span>
          <DownOutlined style={{ fontSize: 12, color: "#8A93A8" }} />
        </div>
      </Dropdown>

      {/* 右上：玻璃工具栏（位置/测距/图层/刷新/标记） */}
      <div style={{ ...floatCard, top: 14, right: 14, display: "flex", gap: 4, padding: "6px 8px", borderRadius: 14 }}>
        <ToolbarBtn icon={<AimOutlined />} tip="我的位置（导航起点）" label="位置" onClick={locateMe} />
        <ToolbarBtn active={measureOpen} icon={<EnvironmentOutlined />} tip="测距定位" label="测距" onClick={() => { setMeasureOpen((v) => !v); setNavOpen(false); }} />
        <ToolbarBtn active={layersOpen} icon={<AppstoreOutlined />} tip="叠加图层开关" label="图层" onClick={() => { setLayersOpen((v) => !v); setMeasureOpen(false); }} />
        <ToolbarBtn icon={<ReloadOutlined />} tip="刷新数据" label="刷新" onClick={() => void load()} />
        <ToolbarBtn active={pickMode === "navStart"} icon={<PlusOutlined />} tip={pickMode === "navStart" ? "取消选起点" : "地图选起点"} label="标记" onClick={() => { setPickMode(pickMode === "navStart" ? "none" : "navStart"); setNavOpen(true); }} />
      </div>

      {/* 图层下拉（挂在工具栏下方）：点击行开/关，激活=品牌浅底 */}
      {layersOpen && (
        <div style={{ ...floatCard, top: 64, right: 14, width: 176, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1E2433" }}>叠加图层</span>
          {layerRows.map((r) => {
            const on = layers[r.key];
            return (
              <div
                key={r.key}
                onClick={() => setLayers((s) => ({ ...s, [r.key]: !on }))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 8px",
                  borderRadius: 10,
                  cursor: "pointer",
                  background: on ? "#EAEFFF" : "#F6F8FE",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: r.dotRadius, background: on ? r.dot : "#CBD6EC", flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, fontWeight: on ? 600 : 400, color: on ? "#3B5BDB" : "#5B6478", whiteSpace: "nowrap" }}>{r.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 测距定位浮层卡 */}
      {measureOpen && (
        <div style={{ ...floatCard, top: 64, right: 14, width: 280, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1E2433" }}>测距定位</span>
          <Select style={{ width: "100%" }} size="small" placeholder="选择线缆" value={selCable} onChange={setSelCable}
            options={cables.filter((c) => c.status === 1).map((c) => ({ value: c.id, label: `${c.name}（${TYPE_LABEL[c.type] ?? c.type}，${Math.round(c.total_length)}m）` }))}
            showSearch optionFilterProp="label" />
          <InputNumber style={{ width: "100%" }} size="small" placeholder="目标距离（米）" min={0} value={distance} onChange={(v) => setDistance(v ?? undefined)} addonAfter="m" />
          <Button type="primary" size="small" icon={<EnvironmentOutlined />} loading={measuring} onClick={doMeasure} block>定位</Button>
          {measureResult && (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="坐标">{measureResult.lat.toFixed(6)}, {measureResult.lng.toFixed(6)}</Descriptions.Item>
              <Descriptions.Item label="累计距离">{measureResult.cumulative_distance.toFixed(2)} m</Descriptions.Item>
              <Descriptions.Item label="线缆总长">{measureResult.total_length.toFixed(2)} m</Descriptions.Item>
              {measureResult.nearest_marker && (
                <Descriptions.Item label="最近标记">{measureResult.nearest_marker.label}（{measureResult.nearest_marker.distance.toFixed(1)} m）</Descriptions.Item>
              )}
            </Descriptions>
          )}
        </div>
      )}

      {/* 左下：故障导航 pill + 图例（纵向堆叠，设计稿布局） */}
      <div style={{ position: "absolute", zIndex: 1000, bottom: 16, left: 16, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
        <div
          onClick={() => { setNavOpen((v) => !v); setMeasureOpen(false); setLayersOpen(false); }}
          style={{ ...floatCard, position: "static", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999, cursor: "pointer" }}
        >
          <AimOutlined style={{ fontSize: 14, color: "#DC2626" }} />
          <span style={{ fontSize: 11.5, fontWeight: 500, color: "#1E2433" }}>
            {navFaultItem ? `#${navFaultItem.id} · ${navFaultItem.fault_type || "故障"} · 导航` : "故障导航"}
          </span>
          <DownOutlined style={{ fontSize: 11, color: "#8A93A8" }} />
        </div>
        <div style={{ ...floatCard, position: "static", display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, pointerEvents: "none" }}>
          <span style={{ fontSize: 10, color: "#5B6478", whiteSpace: "nowrap" }}>
            <span style={{ color: "#5B7FFF" }}>■</span> 线缆 <span style={{ color: "#DC2626" }}>●</span> 故障 <span style={{ color: "#7C3AED" }}>▲</span> 设备 <span style={{ color: "#22C55E" }}>✦</span> 标记
          </span>
        </div>
      </div>

      {/* 故障导航浮层卡 */}
      {navOpen && (
        <div style={{ ...floatCard, bottom: 52, left: 16, width: 300, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1E2433" }}>故障导航</span>
          <Select style={{ width: "100%" }} size="small" placeholder="选择故障点" value={navFault} onChange={setNavFault}
            options={faults.map((f) => ({ value: f.id, label: `#${f.id} ${f.fault_type || "故障"}（${f.description?.slice(0, 12) || ""}）` }))}
            showSearch optionFilterProp="label" />
          <Button size="small" icon={<AimOutlined />} onClick={locateMe} block>使用我的位置</Button>
          <Button size="small" type={pickMode === "navStart" ? "primary" : "default"} onClick={() => setPickMode(pickMode === "navStart" ? "none" : "navStart")} block>
            {pickMode === "navStart" ? "点击地图选择起点…" : "地图选起点"}
          </Button>
          {navStart && <span style={{ fontSize: 11.5, color: "#5B6478" }}>起点：{navStart[0].toFixed(6)}, {navStart[1].toFixed(6)}</span>}
          <Button size="small" type="primary" loading={navigating} onClick={doNavigate} block>开始导航</Button>
          {navResult && (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="直线距离">{navResult.straight_distance.toFixed(1)} m</Descriptions.Item>
              <Descriptions.Item label="沿线剩余">{navResult.remaining_distance.toFixed(1)} m</Descriptions.Item>
              {navResult.projection && (
                <Descriptions.Item label="投影点">{navResult.projection.lat.toFixed(6)}, {navResult.projection.lng.toFixed(6)}（累计 {navResult.projection.cumulative_distance.toFixed(1)} m）</Descriptions.Item>
              )}
              {navResult.candidates.length > 0 && (
                <Descriptions.Item label="候选线缆">{navResult.candidates.map((c) => `${c.cable_name}（${c.distance_to_user.toFixed(0)}m）`).join(" / ")}</Descriptions.Item>
              )}
            </Descriptions>
          )}
        </div>
      )}

      {/* 右下：缩放 + 指北回正 */}
      <div style={{ ...floatCard, bottom: 16, right: 16, display: "flex", alignItems: "flex-end", gap: 6 }}>
        <Tooltip title="回正视图" placement="left">
          <Button
            style={{ width: 30, height: 30, padding: 0, borderRadius: 8, background: "#FFFFFF", border: "1px solid #E4EAF6" }}
            icon={<CompassOutlined style={{ fontSize: 14, color: "#5B6478" }} />}
            onClick={() => map?.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom)}
          />
        </Tooltip>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 0", borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4EAF6" }}>
          <Button type="text" size="small" style={{ width: 32, height: 26, padding: 0, color: "#5B6478" }} icon={<PlusOutlined />} onClick={() => map?.zoomIn()} />
          <div style={{ width: 20, height: 1, background: "#EFF3FC" }} />
          <Button type="text" size="small" style={{ width: 32, height: 26, padding: 0, color: "#5B6478" }} icon={<MinusOutlined />} onClick={() => map?.zoomOut()} />
        </div>
      </div>
    </div>
  );
}
