/** map 模块：地图工作台（/cable/map，cable:view）——底图 + 叠加层开关 + 测距定位 + 故障导航。
 *  v2 界面：左侧玻璃面板（叠加层/测距/导航）+ 地图右上角玻璃工具栏（小图标收纳，少占视野）。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Descriptions, InputNumber, Select, Space, Switch, theme, Tooltip } from "antd";
import { AimOutlined, DoubleLeftOutlined, EnvironmentOutlined, MenuUnfoldOutlined, ReloadOutlined, AppstoreOutlined, GlobalOutlined, LoginOutlined } from "@ant-design/icons";

import type { LatLng } from "@wlt/shared";

import { cableApi, type CableItem, type FaultItem, type MarkerItem, type MeasureResult, type NavigateResult } from "../cable/api";
import { mapApi, type MapSourceInfo } from "./api";
import { MapView } from "./MapView";

const TYPE_LABEL: Record<string, string> = { wire: "电线", fiber: "光缆", network: "网线" };

export function MapWorkbenchPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
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
  const [panelCollapsed, setPanelCollapsed] = useState(false);

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

  /** 地图右上角玻璃工具栏（设计稿：小图标统一收纳右上角）。 */
  const toolbarBtns: { key: string; icon: React.ReactNode; tip: string; onClick: () => void; primary?: boolean }[] = [
    { key: "locate", icon: <AimOutlined />, tip: "我的位置（导航起点）", onClick: locateMe },
    { key: "pick", icon: <LoginOutlined />, tip: pickMode === "navStart" ? "取消选起点" : "地图选起点", onClick: () => setPickMode(pickMode === "navStart" ? "none" : "navStart"), primary: pickMode === "navStart" },
    { key: "measure", icon: <EnvironmentOutlined />, tip: "测距定位", onClick: () => setPanelCollapsed(false) },
    { key: "layers", icon: <AppstoreOutlined />, tip: panelCollapsed ? "显示左侧面板" : "收起左侧面板", onClick: () => setPanelCollapsed((v) => !v) },
    { key: "refresh", icon: <ReloadOutlined />, tip: "刷新数据", onClick: () => void load() },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: "0 auto" }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>地图工作台</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>线缆 / 故障 / 设备 / 标记点统一上图；工具栏小图标收纳到右上角浮层，少占地图视野</p>
        </div>
        <Space>
          <Select
            value={activeSource || undefined}
            placeholder="选择图源"
            style={{ width: 220 }}
            onChange={setActiveSource}
            options={Object.entries(sources).filter(([, v]) => v.enabled !== false).map(([k, v]) => ({ value: k, label: v.name ?? k }))}
            prefix={<GlobalOutlined style={{ color: token.colorTextTertiary }} />}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100dvh - 210px)", minHeight: 480 }}>
        {/* 左侧玻璃面板 */}
        {!panelCollapsed && (
          <div style={{ width: 320, flexShrink: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="wlt-glass" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>叠加图层</span>
                <Button size="small" type="text" icon={<DoubleLeftOutlined />} onClick={() => setPanelCollapsed(true)} />
              </div>
              {([["cables", `线缆层（${cables.length}）`], ["faults", `故障层（${faults.length}）`], ["markers", "标记点层"], ["devices", `设备层（${devices.length}）`]] as const).map(([k, label]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Switch size="small" checked={layers[k]} onChange={(v) => setLayers((s) => ({ ...s, [k]: v }))} />
                  <span style={{ fontSize: 12.5 }}>{label}</span>
                </div>
              ))}
            </div>

            <div className="wlt-glass" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>测距定位</span>
              <Select style={{ width: "100%" }} placeholder="选择线缆" value={selCable} onChange={setSelCable}
                options={cables.filter((c) => c.status === 1).map((c) => ({ value: c.id, label: `${c.name}（${TYPE_LABEL[c.type] ?? c.type}，${Math.round(c.total_length)}m）` }))}
                showSearch optionFilterProp="label" />
              <InputNumber style={{ width: "100%" }} placeholder="目标距离（米）" min={0} value={distance} onChange={(v) => setDistance(v ?? undefined)} addonAfter="m" />
              <Button type="primary" icon={<EnvironmentOutlined />} loading={measuring} onClick={doMeasure} block>定位</Button>
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

            <div className="wlt-glass" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>故障导航</span>
              <Select style={{ width: "100%" }} placeholder="选择故障点" value={navFault} onChange={setNavFault}
                options={faults.map((f) => ({ value: f.id, label: `#${f.id} ${f.fault_type || "故障"}（${f.description?.slice(0, 12) || ""}）` }))}
                showSearch optionFilterProp="label" />
              <Button icon={<AimOutlined />} onClick={locateMe} block>使用我的位置</Button>
              <Button type={pickMode === "navStart" ? "primary" : "default"} onClick={() => setPickMode(pickMode === "navStart" ? "none" : "navStart")} block>
                {pickMode === "navStart" ? "点击地图选择起点…" : "地图选起点"}
              </Button>
              {navStart && <span style={{ fontSize: 11.5, color: token.colorTextSecondary }}>起点：{navStart[0].toFixed(6)}, {navStart[1].toFixed(6)}</span>}
              <Button type="primary" loading={navigating} onClick={doNavigate} block>开始导航</Button>
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
          </div>
        )}

        {/* 地图区 */}
        <div style={{ flex: 1, border: `1px solid ${token.colorBorder}`, borderRadius: 16, overflow: "hidden", position: "relative", boxShadow: "0 8px 30px rgba(30,36,51,.08)" }}>
          <MapView
            sources={sources}
            sourceKey={activeSource || undefined}
            overlays={{ ...overlays, cables: layers.cables ? overlays.cables : [] }}
            highlight={highlight}
            navPath={navResult?.path ?? null}
            onPick={
              pickMode === "navStart"
                ? (lat, lng) => { setNavStart([lat, lng]); setPickMode("none"); }
                : undefined
            }
            picking={pickMode === "navStart" ? "请在故障线路上点击选择导航起点（自动转换为 WGS84）" : undefined}
          />
          {/* 右上角玻璃工具栏（本屏重做重点） */}
          <div style={{ position: "absolute", top: 12, right: 12, zIndex: 1000, display: "flex", gap: 4, padding: 6, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(10px)", border: `1px solid ${token.colorBorder}`, borderRadius: 14, boxShadow: "0 6px 18px rgba(30,36,51,.14)" }}>
            {toolbarBtns.map((b) => (
              <Tooltip key={b.key} title={b.tip} placement="bottom">
                <Button
                  size="small"
                  type={b.primary ? "primary" : "text"}
                  icon={b.icon}
                  onClick={b.onClick}
                  style={{ width: 34, height: 34, borderRadius: 10 }}
                />
              </Tooltip>
            ))}
          </div>
          {panelCollapsed && (
            <Button size="small" style={{ position: "absolute", zIndex: 1000, top: 60, right: 12 }} icon={<MenuUnfoldOutlined />} onClick={() => setPanelCollapsed(false)}>
              显示工具栏
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
