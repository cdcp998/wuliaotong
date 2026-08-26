/** map 模块：地图工作台（/cable/map，cable:view）——《UI设计交付文档.md》设计页 46 落地。
 *
 * v3 界面（OpenPencil 设计稿全工作区化）：
 * - 无页头、无内边距：顶栏以下整块为地图工作区（底图 #DDE7F5）
 * - 左上 图源 pill（点击切换底图）｜右上 玻璃工具栏（位置/测距/图层/刷新/标记/画线，激活=品牌色）
 * - 图层下拉（线缆/故障/设备/标记 点击行开关，激活浅底）挂在工具栏下方
 * - 左下 故障导航 pill（点击展开导航浮层）+ 图例 pill；右下 回到我的定位 + 指北回正（透明容器）+ 缩放
 * - 测距定位为工具栏展开的玻璃浮层卡（线缆选择 + 距离 + 结果）
 *
 * 并发/体验批次新增：手机端可用的定位降级链（浏览器 GPS→IP 兜底）、我的位置标识点、
 * 画线工具、回到正视图自动居中当前位置、显示坐标系默认 GCJ-02（缓存管理可切换 WGS-84）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Descriptions, Dropdown, InputNumber, Select, Tooltip } from "antd";
import { AimOutlined, AppstoreOutlined, CompassOutlined, DownOutlined, EditOutlined, EnvironmentOutlined, GlobalOutlined, MinusOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import L from "leaflet";

import { cumulativeDistances, getCurrentPositionWithFallback, resolveDisplaySpace, toDisplaySpace, type LatLng } from "@wlt/shared";

import { cableApi, type CableItem, type FaultItem, type MarkerItem, type MeasureResult, type NavigateResult } from "../cable/api";
import { mapApi, type MapSourceInfo } from "./api";
import { MapView, type DrawnLine } from "./MapView";

const TYPE_LABEL: Record<string, string> = { wire: "电线", fiber: "光缆", network: "网线" };
/** 「回到正视图」目标视图（有我的位置时居中当前位置，否则回默认中心）。 */
const DEFAULT_VIEW: { center: LatLng; zoom: number } = { center: [30.2741, 120.1551], zoom: 15 };
/** 「回到我的定位」目标缩放级别（街道级）。 */
const MY_LOCATE_ZOOM = 17;

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
  // 定位：我的当前位置（WGS84）+ 定位中标记 + 显示坐标系偏好（缓存管理设置）
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [displayPref, setDisplayPref] = useState<string | null>(null);
  // 画线工具：绘制模式 / 草稿节点（WGS84）/ 已完成线条
  const [drawMode, setDrawMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const lineSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      const [src, cablesResp, faultsResp] = await Promise.all([
        mapApi.mapSources(),
        cableApi.listCables({ page_size: 100 }),
        cableApi.listFaults({ page_size: 100, exclude_closed: true }),
      ]);
      setSources(src.map_sources);
      setDisplayPref(src.cache?.display_coordinate_space ?? null);
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

  /** 当前生效的显示坐标系：非 WGS84 底图按源空间；WGS84 底图按全局偏好（默认 GCJ-02）。 */
  const effSpace = useMemo(() => {
    const srcSpace =
      (activeSource && sources[activeSource]?.coordinate_space) ||
      Object.values(sources).find((s) => s.enabled)?.coordinate_space;
    return resolveDisplaySpace(srcSpace, displayPref);
  }, [sources, activeSource, displayPref]);

  /** 把 WGS84 坐标转为地图显示坐标并平滑飞行过去。 */
  const flyToWgs84 = useCallback(
    (pos: LatLng, zoomLevel?: number) => {
      if (!map) return;
      const [dlng, dlat] = toDisplaySpace(pos[1], pos[0], effSpace);
      map.flyTo([dlat, dlng], zoomLevel ?? Math.max(map.getZoom(), 14), { duration: 0.8 });
    },
    [map, effSpace],
  );

  /** 定位到我的位置（浏览器 GPS → IP 兜底降级链，修复手机端 HTTP 环境无法定位）。
   *  成功后更新「我的位置」标识点并飞到 16 级居中；同时作为导航起点复用。 */
  const locateMe = useCallback(async () => {
    if (myPos) {
      // 已有定位：直接回到我的位置（16 级街道视图）
      setNavStart(myPos);
      flyToWgs84(myPos, MY_LOCATE_ZOOM);
      return;
    }
    setLocating(true);
    try {
      const p = await getCurrentPositionWithFallback();
      const pos: LatLng = [p.lat, p.lng];
      setMyPos(pos);
      setNavStart(pos);
      flyToWgs84(pos, MY_LOCATE_ZOOM);
      if (p.source === "gps") {
        message.success("已定位到当前位置");
      } else {
        message.info("浏览器定位不可用，已使用 IP 粗略定位（精度有限）");
      }
    } catch {
      message.warning("无法获取定位（未授权或网络受限），请点击地图选择起点");
    } finally {
      setLocating(false);
    }
  }, [message, myPos, flyToWgs84]);

  /** 回到正视图：自动拉回初始视角；已有我的位置时居中显示当前位置。 */
  const resetToHomeView = useCallback(() => {
    if (!map) return;
    if (myPos) {
      flyToWgs84(myPos, DEFAULT_VIEW.zoom);
    } else {
      const [dlng, dlat] = toDisplaySpace(DEFAULT_VIEW.center[1], DEFAULT_VIEW.center[0], effSpace);
      map.flyTo([dlat, dlng], DEFAULT_VIEW.zoom, { duration: 0.8 });
    }
  }, [map, myPos, effSpace, flyToWgs84]);

  // ============================ 画线工具 ============================
  const toggleDraw = useCallback(() => {
    setDrawMode((v) => {
      if (!v) {
        setDraftPoints([]);
        setNavOpen(false);
        setMeasureOpen(false);
        setLayersOpen(false);
      }
      return !v;
    });
  }, []);

  /** 完成当前线：落入手工线条列表（继续绘制下一条）。 */
  const finishLine = useCallback(() => {
    if (draftPoints.length < 2) return;
    lineSeq.current += 1;
    setDrawnLines((ls) => [...ls, { id: `draw-${lineSeq.current}`, points: draftPoints }]);
    setDraftPoints([]);
  }, [draftPoints]);

  /** 草稿长度（米，逐点累计；仅交互预览用）。 */
  const draftLengthM = useMemo(() => {
    const dists = cumulativeDistances(draftPoints);
    return dists.length ? dists[dists.length - 1] : 0;
  }, [draftPoints]);

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
        myPosition={myPos}
        extraLines={drawnLines}
        draftLine={drawMode && draftPoints.length > 0 ? draftPoints : null}
        displaySpace={displayPref}
        onMapReady={setMap}
        onPick={
          pickMode === "navStart"
            ? (lat, lng) => { setNavStart([lat, lng]); setPickMode("none"); setNavOpen(true); }
            : drawMode
              ? (lat, lng) => setDraftPoints((pts) => [...pts, [lat, lng]])
              : undefined
        }
        picking={
          pickMode === "navStart"
            ? "请在故障线路上点击选择导航起点（自动转换为 WGS84）"
            : drawMode
              ? "画线模式：点击地图添加节点（右侧可完成/撤销）"
              : undefined
        }
      />

      {/* 左上：图源 pill（点击切换底图） */}
      <Dropdown menu={{ items: sourceItems, selectable: true, selectedKeys: activeKey ? [activeKey] : [], onClick: ({ key }) => setActiveSource(key) }} placement="bottomLeft">
        <div style={{ ...floatCard, top: 14, left: 16, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999, cursor: "pointer" }}>
          <GlobalOutlined style={{ fontSize: 14, color: "#3B5BDB" }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: "#1E2433" }}>{sourceName}</span>
          <DownOutlined style={{ fontSize: 12, color: "#8A93A8" }} />
        </div>
      </Dropdown>

      {/* 右上：玻璃工具栏（位置/测距/图层/刷新/标记/画线） */}
      <div style={{ ...floatCard, top: 14, right: 14, display: "flex", gap: 4, padding: "6px 8px", borderRadius: 14 }}>
        <ToolbarBtn icon={<AimOutlined />} tip="我的位置（导航起点）" label="位置" onClick={() => void locateMe()} />
        <ToolbarBtn active={measureOpen} icon={<EnvironmentOutlined />} tip="测距定位" label="测距" onClick={() => { setMeasureOpen((v) => !v); setNavOpen(false); }} />
        <ToolbarBtn active={layersOpen} icon={<AppstoreOutlined />} tip="叠加图层开关" label="图层" onClick={() => { setLayersOpen((v) => !v); setMeasureOpen(false); }} />
        <ToolbarBtn icon={<ReloadOutlined />} tip="刷新数据" label="刷新" onClick={() => void load()} />
        <ToolbarBtn active={pickMode === "navStart"} icon={<PlusOutlined />} tip={pickMode === "navStart" ? "取消选起点" : "地图选起点"} label="标记" onClick={() => { setPickMode(pickMode === "navStart" ? "none" : "navStart"); setNavOpen(true); }} />
        <ToolbarBtn active={drawMode} icon={<EditOutlined />} tip="画线工具（点击地图添加节点）" label="画线" onClick={toggleDraw} />
      </div>

      {/* 画线浮层卡：节点数/长度 + 撤销/完成/清空 */}
      {drawMode && (
        <div style={{ ...floatCard, top: 64, right: 14, width: 224, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1E2433" }}>画线</span>
          <span style={{ fontSize: 11.5, color: "#5B6478" }}>
            {draftPoints.length} 个节点 · 约 {Math.round(draftLengthM).toLocaleString("zh-CN")} m
          </span>
          <Button size="small" disabled={draftPoints.length === 0} onClick={() => setDraftPoints((pts) => pts.slice(0, -1))} block>
            撤销上一点
          </Button>
          <div style={{ display: "flex", gap: 6 }}>
            <Button type="primary" size="small" disabled={draftPoints.length < 2} onClick={finishLine} style={{ flex: 1 }}>完成本线</Button>
            <Button size="small" disabled={draftPoints.length === 0} onClick={() => setDraftPoints([])} style={{ flex: 1 }}>清空</Button>
          </div>
          {drawnLines.length > 0 && (
            <>
              <span style={{ fontSize: 11.5, color: "#8A93A8" }}>已画 {drawnLines.length} 条线</span>
              <Button size="small" danger onClick={() => setDrawnLines([])} block>清除全部画线</Button>
            </>
          )}
          <span style={{ fontSize: 10.5, color: "#8A93A8" }}>再点「画线」按钮退出绘制模式</span>
        </div>
      )}

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

      {/* 右下：回到我的定位 / 指北回正 + 缩放（功能菜单容器背景透明） */}
      <div style={{ position: "absolute", zIndex: 1000, bottom: 16, right: 16, display: "flex", alignItems: "flex-end", gap: 6, background: "transparent", border: "none", boxShadow: "none" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "transparent" }}>
          <Tooltip title="回到我的定位" placement="left">
            <Button
              loading={locating}
              style={{ width: 30, height: 30, padding: 0, borderRadius: 8, background: "#FFFFFF", border: "1px solid #E4EAF6" }}
              icon={<AimOutlined style={{ fontSize: 14, color: "#3B5BDB" }} />}
              onClick={() => void locateMe()}
            />
          </Tooltip>
          <Tooltip title="回到正视图（自动居中我的当前位置）" placement="left">
            <Button
              style={{ width: 30, height: 30, padding: 0, borderRadius: 8, background: "#FFFFFF", border: "1px solid #E4EAF6" }}
              icon={<CompassOutlined style={{ fontSize: 14, color: "#5B6478" }} />}
              onClick={resetToHomeView}
            />
          </Tooltip>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 0", borderRadius: 12, background: "#FFFFFF", border: "1px solid #E4EAF6" }}>
          <Button type="text" size="small" style={{ width: 32, height: 26, padding: 0, color: "#5B6478" }} icon={<PlusOutlined />} onClick={() => map?.zoomIn()} />
          <div style={{ width: 20, height: 1, background: "#EFF3FC" }} />
          <Button type="text" size="small" style={{ width: 32, height: 26, padding: 0, color: "#5B6478" }} icon={<MinusOutlined />} onClick={() => map?.zoomOut()} />
        </div>
      </div>
    </div>
  );
}
