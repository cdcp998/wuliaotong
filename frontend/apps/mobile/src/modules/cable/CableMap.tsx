/** 手机端：地图（方案 §7.3 地图 Tab）——浏览/故障上报/测距定位/故障导航（<50m 震动+语音播报）。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, Input, NavBar, Picker, Selector, Tag, TextArea, Toast } from "antd-mobile";
import { MapContainer, Marker, Polyline, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { ModuleGate } from "../../components/ModuleGate";
import { cableApi, type CableItem, type FaultItem } from "./api";

interface MeasureResult {
  lat: number;
  lng: number;
  cumulative_distance: number;
  total_length: number;
  nearest_marker: { label: string; distance: number } | null;
}

const icon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:12px;height:12px;border-radius:50%;background:#1668dc;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [12, 12], iconAnchor: [6, 6],
});
const warnIcon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#ff4d4f;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14], iconAnchor: [7, 7],
});

function ClickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

export function MobileCableMapPage() {
  const navigate = useNavigate();
  const [cables, setCables] = useState<CableItem[]>([]);
  const [faults, setFaults] = useState<FaultItem[]>([]);
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
      const [c, f] = await Promise.all([cableApi.list({ page_size: 50 }), cableApi.faults({ page_size: 50 })]);
      setCables(c.items);
      setFaults(f.items);
    } catch {
      /* 模块未启用等由守卫提示 */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 导航轮询：watchPosition 每 2s 调 /geo/navigate，<50m 震动+语音（方案 §13.5）
  const startNav = () => {
    if (!selFaultId) { Toast.show("请先选择故障点"); return; }
    navigator.geolocation?.getCurrentPosition((pos) => {
      const start: [number, number] = [pos.coords.latitude, pos.coords.longitude];
      setNavStart(start);
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
                if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
                if (typeof speechSynthesis !== "undefined") {
                  speechSynthesis.cancel();
                  speechSynthesis.speak(new SpeechSynthesisUtterance(`已接近目标，剩余${r.remaining_distance.toFixed(0)}米`));
                }
                stopNav();
              }
            })
            .catch(() => undefined);
        }, () => undefined, { enableHighAccuracy: true, maximumAge: 2000 });
      };
      tick();
      watchRef.current = window.setInterval(tick, 2000);
    }, () => { Toast.show("无法获取定位，请在地图上点击设置起点"); setMode("navStart"); });
  };
  const stopNav = () => {
    if (watchRef.current) { window.clearInterval(watchRef.current); watchRef.current = null; }
    setNavigating(false);
    setNavInfo("");
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  };
  useEffect(() => () => stopNav(), []);

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
      setPick(null); setDesc(""); setPhoto(null); setReporting(false);
      void load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "上报失败");
      setReporting(false);
    }
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

  return (
    <ModuleGate code="cable" title="地图">
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <NavBar onBack={() => navigate(-1)}>地图工作台</NavBar>
      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer center={[30.2741, 120.1551]} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer url={cableApi.tileUrl("esri", "{z}", "{x}", "{y}")} maxZoom={19} attribution="© 卫星影像" />
          <ClickCatcher onPick={(lat, lng) => {
            if (mode === "fault") { setPick({ lat, lng }); setMode("none"); }
            else if (mode === "navStart") { setNavStart([lat, lng]); setMode("none"); }
            else setPick({ lat, lng });
          }} />
          {cables.filter((c) => c.geometry).map((c) => (
            <Polyline key={c.id} positions={(c.geometry!.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number])}
              pathOptions={{ color: "#1668dc", weight: 4 }} />
          ))}
          {faults.map((f) => <Marker key={f.id} position={[f.lat, f.lng]} icon={warnIcon} />)}
          {highlight && <Marker position={highlight} icon={icon} />}
          {navPath && navPath.length > 1 && (
            <Polyline positions={navPath} pathOptions={{ color: "#fa541c", weight: 5, dashArray: "8 6" }} />
          )}
        </MapContainer>
        {/* 顶部工具栏 */}
        <div style={{ position: "absolute", top: 8, left: 8, right: 8, display: "flex", gap: 8, zIndex: 1000 }}>
          <Button size="small" color="primary" onClick={() => { setMode(mode === "fault" ? "none" : "fault"); Toast.show(mode === "fault" ? "" : "点击地图选择故障位置"); }}>上报故障</Button>
          <Button size="small" onClick={() => setMode(mode === "navStart" ? "none" : "navStart")}>选起点</Button>
          <Button size="small" onClick={startNav} disabled={!selFaultId}>导航</Button>
          {navigating && <Button size="small" fill="outline" onClick={stopNav}>停止</Button>}
        </div>
        {/* 提示 */}
        {mode === "fault" && <div style={{ position: "absolute", top: 48, left: 8, background: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12, zIndex: 1000 }}>请点击地图选择故障位置</div>}
        {navInfo && <div style={{ position: "absolute", bottom: 12, left: 8, right: 8, background: "#fff", padding: 8, borderRadius: 8, fontSize: 14, zIndex: 1000, textAlign: "center" }}>{navInfo}</div>}
      </div>

      {/* 故障上报表单 */}
      <Card style={{ borderTopLeftRadius: 16, borderTopRightRadius: 16, marginTop: -12, position: "relative", zIndex: 1000 }}>
        {pick && (
          <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>位置：{pick.lat.toFixed(6)}, {pick.lng.toFixed(6)}</div>
        )}
        <Selector options={[{ label: "低", value: 1 }, { label: "中", value: 2 }, { label: "高", value: 3 }]} value={[sev]} onChange={(v) => setSev(v[0] ?? 1)} style={{ marginBottom: 8 }} />
        <TextArea placeholder="故障描述（可选）" value={desc} onChange={setDesc} rows={2} maxLength={500} style={{ marginBottom: 8 }} />
        <input type="file" accept="image/*" style={{ display: "none" }} id="fault-photo" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        <label htmlFor="fault-photo" style={{ display: "inline-block", marginBottom: 8, color: "#1668dc", fontSize: 14 }}>{photo ? "已选照片（点击更换）" : "+ 拍照/选择现场照片"}</label>
        <Button block color="primary" loading={reporting} disabled={!pick} onClick={submitFault}>提交故障上报</Button>
      </Card>

      {/* 测距 */}
      <Card>
        <Tag color="blue" style={{ marginBottom: 8 }}>测距定位</Tag>
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
      </Card>

      {/* 导航选故障 */}
      <Card style={{ marginBottom: 12 }}>
        <Tag color="orange" style={{ marginBottom: 8 }}>故障导航</Tag>
        <Picker
          columns={[faults.map((f) => ({ label: `#${f.id} ${f.fault_type || "故障"}（${f.description?.slice(0, 10) || ""}）`, value: f.id }))]}
          onConfirm={(v) => setSelFaultId(v[0] as number)}
        >
          {(items) => <Button size="small" fill="outline">{items[0]?.label ?? "选择故障点"}</Button>}
        </Picker>
        {navStart && <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>起点 {navStart[0].toFixed(6)}, {navStart[1].toFixed(6)}</div>}
      </Card>
    </div>
    </ModuleGate>
  );
}
