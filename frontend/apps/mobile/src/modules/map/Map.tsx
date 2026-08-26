/** 手机端：地图工作台（map 模块，方案 §7.3）——全屏地图 + 底部工具栏（上报/故障管理/测距/导航），
 * 点击按钮弹窗打开对应面板（Popup 弹层，可关闭）。依赖 cable 模块数据（线缆/故障）。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Dialog, Input, NavBar, Picker, Popup, Selector, Switch, Tag, TextArea, Toast } from "antd-mobile";
import { MapContainer, Marker, Polyline, TileLayer, useMapEvents, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { ModuleGate } from "../../components/ModuleGate";
import { cableApi, type CableItem, type FaultItem } from "../cable/api";
import { mapApi } from "./api";

interface MeasureResult {
  lat: number;
  lng: number;
  cumulative_distance: number;
  total_length: number;
  nearest_marker: { label: string; distance: number } | null;
}

// v1.1 六态（与维修任务态联动）：0待派发/1已派发/2进行中/3完成待验/4已验证/5已关闭
const FAULT_STATUS = ["待派发", "已派发", "进行中", "完成待验", "已验证", "已关闭"];

const warnIcon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#EF4444;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14], iconAnchor: [7, 7],
});
const navIcon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#EF4444;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8],
});

function ClickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

type PanelKey = "report" | "faults" | "measure" | "nav" | "layers" | null;

const TOOLS: { key: Exclude<PanelKey, null>; label: string; color: string }[] = [
  { key: "report", label: "上报", color: "#EF4444" },
  { key: "faults", label: "故障", color: "#fa8c16" },
  { key: "measure", label: "测距", color: "#5B7FFF" },
  { key: "nav", label: "导航", color: "#EF4444" },
];

export function MobileMapPage() {
  const navigate = useNavigate();
  const [cables, setCables] = useState<CableItem[]>([]);
  const [faults, setFaults] = useState<FaultItem[]>([]);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [layers, setLayers] = useState({ cables: true, faults: true });

  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(null);
  const [mode, setMode] = useState<"none" | "fault" | "navStart">("none");
  const [reporting, setReporting] = useState(false);
  const [sev, setSev] = useState(1);
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [selCableId, setSelCableId] = useState<number | undefined>();
  const [distance, setDistance] = useState("");
  const [measureResult, setMeasureResult] = useState<MeasureResult | null>(null);
  const [highlight, setHighlight] = useState<[number, number] | null>(null);
  const [selFaultId, setSelFaultId] = useState<number | undefined>();
  const [navStart, setNavStart] = useState<[number, number] | null>(null);
  const [navInfo, setNavInfo] = useState<string>("");
  const [navPath, setNavPath] = useState<[number, number][] | null>(null);
  const [navigating, setNavigating] = useState(false);
  const watchRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([cableApi.list({ page_size: 50 }), cableApi.faults({ page_size: 50, exclude_closed: true })]);
      setCables(c.items);
      setFaults(f.items);
    } catch {
      /* 模块未启用等由守卫提示 */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stopNav = () => {
    if (watchRef.current) { window.clearInterval(watchRef.current); watchRef.current = null; }
    setNavigating(false);
    setNavInfo("");
  };
  useEffect(() => () => { stopNav(); }, []);

  const startNav = () => {
    if (!selFaultId) { Toast.show("请先选择故障点"); return; }
    navigator.geolocation?.getCurrentPosition((pos) => {
      setNavStart([pos.coords.latitude, pos.coords.longitude]);
      setNavigating(true);
      setNavInfo("正在导航…");
      const tick = () => {
        navigator.geolocation?.getCurrentPosition((p) => {
          const lat = p.coords.latitude;
          const lng = p.coords.longitude;
          let heading: number | undefined;
          if (p.coords.heading != null && !Number.isNaN(p.coords.heading)) heading = p.coords.heading;
          cableApi.navigate({ lat, lng, fault_id: selFaultId, heading })
            .then((r) => {
              setNavPath(r.path as [number, number][]);
              if (r.projection) setHighlight([r.projection.lat, r.projection.lng]);
              setNavInfo(`剩余 ${r.remaining_distance.toFixed(0)}m（直线 ${r.straight_distance.toFixed(0)}m）`);
              if (r.remaining_distance < 50) {
                stopNav();
              }
            })
            .catch(() => undefined);
        }, () => undefined, { enableHighAccuracy: true, maximumAge: 2000 });
      };
      tick();
      watchRef.current = window.setInterval(tick, 2000);
    }, () => { Toast.show("无法获取定位，请在导航弹窗中「选起点」"); setPanel("nav"); setMode("navStart"); });
  };

  const submitFault = async () => {
    if (!pick) return;
    setReporting(true);
    try {
      const r = await cableApi.createFault({ lat: pick.lat, lng: pick.lng, severity: sev, description: desc });
      if (photo) {
        const { fileApi } = await import("@wlt/shared");
        const up = await fileApi.upload(photo, "fault");
        await cableApi.addFaultPhoto(r.id, up.file_id);
      }
      Toast.show("故障已上报");
      setPick(null); setDesc(""); setPhoto(null);
      setPanel(null); // 弹窗关闭
      setReporting(false);
      void load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "上报失败");
      setReporting(false);
    }
  };

  const deleteFault = (f: FaultItem) => {
    Dialog.confirm({
      content: `删除故障标点 #${f.id}「${f.fault_type || "故障"}」？仅从界面移除（软删除可追溯）。`,
      onConfirm: async () => {
        try {
          await cableApi.deleteFault(f.id);
          Toast.show("已删除标点");
          void load();
        } catch (e) {
          Toast.show(e instanceof Error ? e.message : "删除失败（仅本人上报或调度员可删）");
        }
      },
    });
  };

  const doMeasure = async () => {
    if (!selCableId || !distance) { Toast.show("请选择线缆并输入距离"); return; }
    try {
      const r = await cableApi.measure({ cable_id: selCableId, distance: Number(distance) });
      setMeasureResult(r);
      setHighlight([r.lat, r.lng]);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "测距失败");
    }
  };

  const openPanel = (key: Exclude<PanelKey, null>) => {
    setPanel((cur) => (cur === key ? null : key));
    if (key === "faults") void load();
  };

  return (
    <ModuleGate code="map" title="地图">
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <NavBar onBack={() => navigate(-1)}>地图工作台</NavBar>
      {/* 地图区（全屏最大化；底部工具栏常驻） */}
      <div style={{ flex: 1, position: "relative", minHeight: 0, marginBottom: 56 }}>
        <MapContainer center={[30.2741, 120.1551]} zoom={12} zoomControl={false} style={{ height: "100%", width: "100%" }}>
          <ZoomControl position="bottomright" />
          <TileLayer url={mapApi.tileUrl("esri", "{z}", "{x}", "{y}")} maxZoom={19} attribution="© 卫星影像" />
          <ClickCatcher onPick={(lat, lng) => {
            if (mode === "fault") { setPick({ lat, lng }); setMode("none"); }
            else if (mode === "navStart") { setNavStart([lat, lng]); setMode("none"); }
            else setPick({ lat, lng });
          }} />
          {layers.cables && cables.filter((c) => c.geometry).map((c) => (
            <Polyline key={c.id} positions={(c.geometry!.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number])}
              pathOptions={{ color: "#5B7FFF", weight: 4 }} />
          ))}
          {layers.faults && faults.map((f) => <Marker key={f.id} position={[f.lat, f.lng]} icon={warnIcon} />)}
          {highlight && <Marker position={highlight} icon={navIcon} />}
          {navPath && navPath.length > 1 && (
            <Polyline positions={navPath} pathOptions={{ color: "#EF4444", weight: 5, dashArray: "8 6" }} />
          )}
        </MapContainer>
        {/* 图层叠加选择（右上角小图标，主流地图交互） */}
        <div
          onClick={() => setPanel(panel === "layers" ? null : "layers")}
          style={{
            position: "absolute", top: 8, right: 8, zIndex: 1000, width: 34, height: 34, borderRadius: 10,
            background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,.18)", display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer",
          }}
        >
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke={panel === "layers" ? "#5B7FFF" : "#555"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l9 5-9 5-9-5 9-5z" />
            <path d="M3 13l9 5 9-5" />
          </svg>
        </div>
        {mode === "fault" && <div style={{ position: "absolute", top: 8, left: 8, background: "#fff", padding: "4px 10px", borderRadius: 8, fontSize: 12, zIndex: 1000 }}>请点击地图选择故障位置</div>}
        {navInfo && <div style={{ position: "absolute", bottom: 12, left: 8, right: 8, background: "#fff", padding: 8, borderRadius: 12, fontSize: 14, zIndex: 1000, textAlign: "center" }}>{navInfo}</div>}
      </div>

      {/* 底部工具栏（固定；zIndex 低于 Popup，避免遮挡呼出的功能界面） */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 900,
        display: "flex", background: "rgba(255,255,255,0.94)", backdropFilter: "blur(10px)",
        borderTop: "1px solid #E4EAF6", boxShadow: "0 -4px 16px rgba(30,36,51,.08)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {TOOLS.map((t) => (
          <div key={t.key} onClick={() => openPanel(t.key)}
            style={{ flex: 1, padding: "8px 0 6px", textAlign: "center", cursor: "pointer", color: panel === t.key ? t.color : "#5B6478", fontSize: 11 }}>
            <div style={{ width: 22, height: 22, margin: "0 auto 2px", borderRadius: 11, background: panel === t.key ? t.color : "#f2f3f5", color: "#fff", lineHeight: "22px", fontSize: 13 }}>●</div>
            {t.label}
          </div>
        ))}
      </div>

      {/* 图层叠加选择（右上角小图标呼出） */}
      <Popup visible={panel === "layers"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <div style={{ padding: 16, paddingBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 600 }}>图层叠加</span>
            <span style={{ color: "#999", fontSize: 13 }} onClick={() => setPanel(null)}>收起 ×</span>
          </div>
          {[
            { key: "cables" as const, label: "线缆", color: "#5B7FFF" },
            { key: "faults" as const, label: "故障点", color: "#EF4444" },
          ].map((l) => (
            <div key={l.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F2F5FB" }}>
              <span style={{ fontSize: 14 }}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: l.key === "cables" ? 1 : 5, background: l.color, marginRight: 8, verticalAlign: "middle" }} />
                {l.label}
              </span>
              <Switch checked={layers[l.key]} onChange={(v) => setLayers((s) => ({ ...s, [l.key]: v }))} />
            </div>
          ))}
        </div>
      </Popup>

      {/* 弹窗式面板（Popup 底部弹层，可关闭） */}
      <Popup visible={panel === "report"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "75dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 600 }}>上报故障</span>
            <span style={{ color: "#999", fontSize: 13 }} onClick={() => setPanel(null)}>收起 ×</span>
          </div>
          {pick && <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>位置：{pick.lat.toFixed(6)}, {pick.lng.toFixed(6)}</div>}
          <Button block size="small" fill="outline" color="danger" onClick={() => setMode(mode === "fault" ? "none" : "fault")} style={{ marginBottom: 8 }}>
            {mode === "fault" ? "点击地图取点中…（再点取消）" : (pick ? "重新选择位置" : "在地图上选择位置")}
          </Button>
          <Selector options={[{ label: "低", value: 1 }, { label: "中", value: 2 }, { label: "高", value: 3 }]} value={[sev]} onChange={(v) => setSev(v[0] ?? 1)} style={{ marginBottom: 8 }} />
          <TextArea placeholder="故障描述（可选）" value={desc} onChange={setDesc} rows={2} maxLength={500} style={{ marginBottom: 8 }} />
          <input type="file" accept="image/*" style={{ display: "none" }} id="fault-photo" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <label htmlFor="fault-photo" style={{ display: "inline-block", marginBottom: 8, color: "#5B7FFF", fontSize: 14 }}>{photo ? "已选照片（点击更换）" : "+ 拍照/选择现场照片"}</label>
          <Button block color="danger" loading={reporting} disabled={!pick} onClick={submitFault}>提交故障上报</Button>
        </div>
      </Popup>

      <Popup visible={panel === "faults"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "75dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 600 }}>故障管理（共 {faults.length} 条）</span>
            <span style={{ color: "#5B7FFF", fontSize: 13 }} onClick={() => void load()}>刷新</span>
          </div>
          {faults.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #F2F5FB" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>
                  #{f.id}　{f.fault_type || "未分类"}　<Tag color={f.severity === 3 ? "danger" : f.severity === 2 ? "warning" : "default"}>{["低", "中", "高"][f.severity - 1] ?? f.severity}</Tag>
                </div>
                <div style={{ fontSize: 11, color: "#888" }}>{f.lat.toFixed(5)}, {f.lng.toFixed(5)}　{FAULT_STATUS[f.status] ?? f.status}</div>
              </div>
              <Button size="mini" color="primary" fill="outline" onClick={() => { setHighlight([f.lat, f.lng]); setPanel(null); }}>定位</Button>
              <Button size="mini" color="danger" fill="outline" onClick={() => deleteFault(f)}>删除标点</Button>
            </div>
          ))}
          {faults.length === 0 && <div style={{ textAlign: "center", color: "#999", padding: 16 }}>暂无故障</div>}
        </div>
      </Popup>

      <Popup visible={panel === "measure"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "60dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 600 }}>测距定位</span>
            <span style={{ color: "#999", fontSize: 13 }} onClick={() => setPanel(null)}>收起 ×</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Picker
              columns={[cables.filter((c) => c.status === 1).map((c) => ({ label: `${c.name}（${Math.round(c.total_length)}m）`, value: c.id }))]}
              onConfirm={(v) => setSelCableId(v[0] as number)}
            >
              {(items) => <Button size="small" fill="outline">{items[0]?.label ?? "选择线缆"}</Button>}
            </Picker>
            <Input placeholder="距离(m)" type="number" value={distance} onChange={setDistance} style={{ flex: 1 }} />
            <Button size="small" color="primary" onClick={doMeasure}>定位</Button>
          </div>
          {measureResult && (
            <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
              定位点 {measureResult.lat.toFixed(6)}, {measureResult.lng.toFixed(6)}　累计 {measureResult.cumulative_distance.toFixed(1)}m
              {measureResult.nearest_marker && `　最近：${measureResult.nearest_marker.label}（${measureResult.nearest_marker.distance.toFixed(1)}m）`}
            </div>
          )}
        </div>
      </Popup>

      <Popup visible={panel === "nav"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "60dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 600 }}>故障导航</span>
            <span style={{ color: "#999", fontSize: 13 }} onClick={() => setPanel(null)}>收起 ×</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Picker
              columns={[faults.map((f) => ({ label: `#${f.id} ${f.fault_type || "故障"}（${f.description?.slice(0, 10) || ""}）`, value: f.id }))]}
              onConfirm={(v) => setSelFaultId(v[0] as number)}
            >
              {(items) => <Button size="small" fill="outline">{items[0]?.label ?? "选择故障点"}</Button>}
            </Picker>
            <Button size="small" fill="outline" onClick={() => setMode(mode === "navStart" ? "none" : "navStart")}>
              {mode === "navStart" ? "取点中…" : "选起点"}
            </Button>
          </div>
          {navStart && <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>起点 {navStart[0].toFixed(6)}, {navStart[1].toFixed(6)}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button block color="primary" size="small" onClick={startNav} disabled={!selFaultId}>{navigating ? "导航中…" : "开始导航"}</Button>
            <Button block size="small" fill="outline" onClick={stopNav}>停止</Button>
          </div>
        </div>
      </Popup>
    </div>
    </ModuleGate>
  );
}
