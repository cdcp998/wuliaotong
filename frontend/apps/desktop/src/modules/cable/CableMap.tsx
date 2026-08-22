/** cable 模块：地图工作台（/cable/map，cable:view）——底图 + 叠加层开关 + 测距定位 + 故障导航。
 * 左侧工具栏可折叠（地图全宽/还原）。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Descriptions, InputNumber, Select, Space, Switch, Typography } from "antd";
import { AimOutlined, DoubleLeftOutlined, EnvironmentOutlined, MenuUnfoldOutlined } from "@ant-design/icons";

import type { LatLng } from "@wlt/shared";

import { cableApi, type CableItem, type FaultItem, type MapSourceInfo, type MarkerItem, type MeasureResult, type NavigateResult } from "./api";
import { MapView } from "./MapView";

const TYPE_LABEL: Record<string, string> = { wire: "电线", fiber: "光缆", network: "网线" };

export function CableMapPage() {
  const { message } = App.useApp();
  const [sources, setSources] = useState<Record<string, MapSourceInfo>>({});
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
        cableApi.mapSources(),
        cableApi.listCables({ page_size: 100 }),
        cableApi.listFaults({ page_size: 100 }),
      ]);
      setSources(src.map_sources);
      setCables(cablesResp.items);
      setFaults(faultsResp.items);
      // 标记点（每根线缆拉取）
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
      // 设备层（device 模块启用时；未启用/无权限静默忽略）
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
  }, [message]);

  useEffect(() => {
    void load();
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

  const locateMe = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setNavStart([pos.coords.latitude, pos.coords.longitude]),
      () => message.warning("无法获取定位，请点击地图选择起点（进入「选起点」模式）"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

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

  return (
    <div style={{ display: "flex", gap: 12, height: "calc(100dvh - 140px)", minHeight: 480 }}>
      {!panelCollapsed && (
      <div style={{ width: 330, flexShrink: 0, overflow: "auto" }}>
        <Card size="small" title="叠加层" style={{ marginBottom: 8 }} extra={<Button size="small" type="text" icon={<DoubleLeftOutlined />} onClick={() => setPanelCollapsed(true)} />}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Space>
              <Switch checked={layers.cables} onChange={(v) => setLayers((s) => ({ ...s, cables: v }))} />
              <span>线缆层（{cables.length}）</span>
            </Space>
            <Space>
              <Switch checked={layers.faults} onChange={(v) => setLayers((s) => ({ ...s, faults: v }))} />
              <span>故障层（{faults.length}）</span>
            </Space>
            <Space>
              <Switch checked={layers.markers} onChange={(v) => setLayers((s) => ({ ...s, markers: v }))} />
              <span>标记点层</span>
            </Space>
            <Space>
              <Switch checked={layers.devices} onChange={(v) => setLayers((s) => ({ ...s, devices: v }))} />
              <span>设备层（{devices.length}）</span>
            </Space>
          </Space>
        </Card>

        <Card size="small" title="测距定位" style={{ marginBottom: 8 }}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Select
              style={{ width: "100%" }}
              placeholder="选择线缆"
              value={selCable}
              onChange={setSelCable}
              options={cables.filter((c) => c.status === 1).map((c) => ({ value: c.id, label: `${c.name}（${TYPE_LABEL[c.type] ?? c.type}，${Math.round(c.total_length)}m）` }))}
              showSearch
              optionFilterProp="label"
            />
            <InputNumber
              style={{ width: "100%" }}
              placeholder="目标距离（米）"
              min={0}
              value={distance}
              onChange={(v) => setDistance(v ?? undefined)}
              addonAfter="m"
            />
            <Button type="primary" block icon={<EnvironmentOutlined />} loading={measuring} onClick={doMeasure}>
              定位
            </Button>
            {measureResult && (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="坐标">
                  {measureResult.lat.toFixed(6)}, {measureResult.lng.toFixed(6)}
                </Descriptions.Item>
                <Descriptions.Item label="累计距离">{measureResult.cumulative_distance.toFixed(2)} m</Descriptions.Item>
                <Descriptions.Item label="线缆总长">{measureResult.total_length.toFixed(2)} m</Descriptions.Item>
                {measureResult.nearest_marker && (
                  <Descriptions.Item label="最近标记">
                    {measureResult.nearest_marker.label}（{measureResult.nearest_marker.distance.toFixed(1)} m）
                  </Descriptions.Item>
                )}
              </Descriptions>
            )}
          </Space>
        </Card>

        <Card size="small" title="故障导航">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Select
              style={{ width: "100%" }}
              placeholder="选择故障点"
              value={navFault}
              onChange={setNavFault}
              options={faults.map((f) => ({ value: f.id, label: `#${f.id} ${f.fault_type || "故障"}（${f.description?.slice(0, 12) || ""}）` }))}
              showSearch
              optionFilterProp="label"
            />
            <Button block icon={<AimOutlined />} onClick={locateMe}>
              使用我的位置
            </Button>
            <Button block type={pickMode === "navStart" ? "primary" : "default"} onClick={() => setPickMode(pickMode === "navStart" ? "none" : "navStart")}>
              {pickMode === "navStart" ? "点击地图选择起点…" : "地图选起点"}
            </Button>
            {navStart && (
              <Typography.Text type="secondary">
                起点：{navStart[0].toFixed(6)}, {navStart[1].toFixed(6)}
              </Typography.Text>
            )}
            <Button block type="primary" loading={navigating} onClick={doNavigate}>
              开始导航
            </Button>
            {navResult && (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="直线距离">{navResult.straight_distance.toFixed(1)} m</Descriptions.Item>
                <Descriptions.Item label="沿线剩余">{navResult.remaining_distance.toFixed(1)} m</Descriptions.Item>
                {navResult.projection && (
                  <Descriptions.Item label="投影点">
                    {navResult.projection.lat.toFixed(6)}, {navResult.projection.lng.toFixed(6)}（累计 {navResult.projection.cumulative_distance.toFixed(1)} m）
                  </Descriptions.Item>
                )}
                {navResult.candidates.length > 0 && (
                  <Descriptions.Item label="候选线缆">
                    {navResult.candidates.map((c) => `${c.cable_name}（${c.distance_to_user.toFixed(0)}m）`).join(" / ")}
                  </Descriptions.Item>
                )}
              </Descriptions>
            )}
          </Space>
        </Card>
      </div>
      )}

      <div style={{ flex: 1, border: "1px solid #e5e6eb", borderRadius: 8, overflow: "hidden", position: "relative" }}>
        {panelCollapsed && (
          <Button
            size="small"
            style={{ position: "absolute", zIndex: 1000, top: 8, left: 8 }}
            icon={<MenuUnfoldOutlined />}
            onClick={() => setPanelCollapsed(false)}
          >
            显示工具栏
          </Button>
        )}
        <MapView
          sources={sources}
          overlays={{ ...overlays, cables: layers.cables ? overlays.cables : [] }}
          highlight={highlight}
          navPath={navResult?.path ?? null}
          onPick={
            pickMode === "navStart"
              ? (lat, lng) => {
                  setNavStart([lat, lng]);
                  setPickMode("none");
                }
              : undefined
          }
          picking={pickMode === "navStart" ? "请在故障线路上点击选择导航起点（自动转换为 WGS84）" : undefined}
        />
      </div>
    </div>
  );
}
