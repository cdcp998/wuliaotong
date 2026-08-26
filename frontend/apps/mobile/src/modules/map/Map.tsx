/** 手机端：地图工作台（map 模块，方案 §7.3）——OP 规格（设计页 M2）重构：
 * NavBar「‹ 地图 · 右侧图层」；地图全屏（左上「故障 n · 线缆 n」白底徽标胶囊 +
 * 右上 36×36 图层按钮）；底部五键工具栏（我的位置/测距/图层/故障/上报，10px 标签，
 * 激活深蓝加粗）；图层弹层三行（线缆层/故障层/设备层，圆点 蓝/红/紫 + 开关）。
 *
 * 业务逻辑保留：故障上报弹层、故障管理（行内 定位/导航/删除）、测距定位、故障导航
 * （从「故障」面板行内进入）、定位降级链、显示坐标 GCJ-02 转换、最后定位持久化。
 * 「导航」不再占工具栏：由故障面板行内发起（先选故障再导航，语义更顺）。
 *
 * 体验修复批次（沿用）：定位降级链（GPS→IP 兜底）；显示层坐标转换；我的位置蓝色标识点。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Dialog, Input, NavBar, Picker, Popup, Selector, Switch, TextArea, Toast } from "antd-mobile";
import { MapContainer, Marker, Polyline, TileLayer, useMapEvents, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { fromDisplaySpace, getCurrentPositionWithFallback, resolveDisplaySpace, toDisplaySpace } from "@wlt/shared";

import { ModuleGate } from "../../components/ModuleGate";
import { cableApi, type CableItem, type FaultItem } from "../cable/api";
import { deviceApi, type DeviceItem } from "../api";
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
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#DC2626;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14], iconAnchor: [7, 7],
});
const navIcon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#EF4444;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8],
});
/** 设备层：紫色方形小点（OP 设备 Dot r1 #7C3AED）。 */
const deviceIcon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:10px;height:10px;border-radius:2px;background:#7C3AED;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.35)"></div>',
  iconSize: [10, 10], iconAnchor: [5, 5],
});
/** 我的位置：蓝色定位标识点（外圈光晕 + 内芯）。 */
const myLocationIcon = L.divIcon({
  className: "wlt-m",
  html:
    '<div style="position:relative;width:22px;height:22px">' +
    '<span style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,.30)"></span>' +
    '<span style="position:absolute;left:5px;top:5px;width:12px;height:12px;border-radius:50%;background:#3B82F6;border:2px solid #fff;box-shadow:0 0 6px rgba(37,99,235,.8)"></span>' +
    "</div>",
  iconSize: [22, 22], iconAnchor: [11, 11],
});
/** 上报取点：红色大头针（地图选中的待上报位置）。 */
const pickIcon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:16px;height:16px;background:#DC2626;border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 15],
});
/** 导航起点：绿色大头针（与桌面端「选起点」绿色标记一致）。 */
const startIcon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:16px;height:16px;background:#22C55E;border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 15],
});
/** 画线顶点：琥珀小圆点。 */
const vertexIcon = L.divIcon({
  className: "wlt-m",
  html: '<div style="width:10px;height:10px;border-radius:50%;background:#F59E0B;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>',
  iconSize: [10, 10], iconAnchor: [5, 5],
});

/** 显示坐标系：手机端底图固定经后端代理（WGS84 源）→ 默认 GCJ-02 加密显示（与桌面端一致）。 */
const DISPLAY_SPACE = resolveDisplaySpace("wgs84", null);

/** 最后定位持久化（与桌面端共用键）：再次打开地图自动回到上次位置。 */
const LAST_POS_KEY = "wlt.map.last_position";

function loadLastPosition(): [number, number] | null {
  try {
    const raw = localStorage.getItem(LAST_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { lat?: number; lng?: number };
    if (typeof p.lat === "number" && typeof p.lng === "number") return [p.lat, p.lng];
  } catch {
    /* 损坏数据/隐私模式忽略 */
  }
  return null;
}

function ClickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      // 地图点击为显示坐标 → 转回 WGS84 再交给业务（入库/接口一律 WGS84）
      const [lng, lat] = fromDisplaySpace(e.latlng.lng, e.latlng.lat, DISPLAY_SPACE);
      onPick(lat, lng);
    },
  });
  return null;
}

/** 显示坐标 → Leaflet [lat, lng]。 */
function disp([lat, lng]: [number, number]): [number, number] {
  const [dlng, dlat] = toDisplaySpace(lng, lat, DISPLAY_SPACE);
  return [dlat, dlng];
}

/** 两 WGS84 坐标间球面距离（米，haversine）——画线测长用。 */
function distMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 距离展示：<1km 显示米，≥1km 显示公里。 */
function fmtLen(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

type PanelKey = "report" | "faults" | "measure" | "nav" | "layers" | null;
type MapMode = "none" | "fault" | "navStart" | "draw";

/** 工具栏六键（位置/测距/画线/图层/故障/上报）。location 为即时动作；draw 进入画线取点模式。 */
const TOOLS: { key: PanelKey | "location" | "draw"; label: string; icon: React.ReactNode }[] = [
  {
    key: "location",
    label: "我的位置",
    icon: (
      <>
        <path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.6" />
      </>
    ),
  },
  {
    key: "measure",
    label: "测距",
    icon: (
      <>
        <path d="M3 16.5L16.5 3 21 7.5 7.5 21z" />
        <path d="M7 13l2 2M10.5 9.5l2 2M14 6l2 2" />
      </>
    ),
  },
  {
    key: "draw",
    label: "画线",
    icon: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5l4 4L8 20l-5 1 1-5z" />
      </>
    ),
  },
  {
    key: "layers",
    label: "图层",
    icon: (
      <>
        <path d="M12 3l9 5-9 5-9-5 9-5z" />
        <path d="M3 13l9 5 9-5" />
      </>
    ),
  },
  {
    key: "faults",
    label: "故障",
    icon: (
      <>
        <path d="M12 3L2 20h20L12 3z" />
        <path d="M12 10v4M12 17h.01" />
      </>
    ),
  },
  {
    key: "report",
    label: "上报",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
  },
];

export function MobileMapPage() {
  const navigate = useNavigate();
  const mapRef = useRef<L.Map | null>(null);
  const [cables, setCables] = useState<CableItem[]>([]);
  const [faults, setFaults] = useState<FaultItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]); // 设备层数据（模块未启用时为空）
  const [panel, setPanel] = useState<PanelKey>(null);
  const [layers, setLayers] = useState({ cables: true, faults: true, devices: true });

  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(null);
  const [mode, setMode] = useState<MapMode>("none");
  // 画线（临时测量线）：逐点落针成线，实时显示总长；仅前端展示，不落库
  const [draftPts, setDraftPts] = useState<[number, number][]>([]);
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
  const [myPos, setMyPos] = useState<[number, number] | null>(loadLastPosition);
  const [navInfo, setNavInfo] = useState<string>("");
  const [navPath, setNavPath] = useState<[number, number][] | null>(null);
  const [navigating, setNavigating] = useState(false);
  const watchRef = useRef<number | null>(null);
  // 打开地图回到最后定位（无历史则默认中心）；定位更新即持久化
  const initialCenter = useMemo(() => loadLastPosition() ?? ([30.2741, 120.1551] as [number, number]), []);

  useEffect(() => {
    if (!myPos) return;
    try {
      localStorage.setItem(LAST_POS_KEY, JSON.stringify({ lat: myPos[0], lng: myPos[1], at: Date.now() }));
    } catch {
      /* 存储不可用时静默 */
    }
  }, [myPos]);

  const load = useCallback(async () => {
    // 设备层并行加载（device 模块禁用/无权限时静默为空）
    const [c, f, d] = await Promise.allSettled([
      cableApi.list({ page_size: 50 }),
      cableApi.faults({ page_size: 50, exclude_closed: true }),
      deviceApi.list({ page_size: 100 }),
    ]);
    if (c.status === "fulfilled") setCables(c.value.items);
    if (f.status === "fulfilled") setFaults(f.value.items);
    if (d.status === "fulfilled") {
      setDevices(d.value.items.filter((x) => x.lat != null && x.lng != null));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 滚轮选择器「双击直接确定」：dblclick 落在 .adm-picker 内时，代点其内置「确定」按钮
  // （antd-mobile v5 Picker 未提供该交互；双击目标即当前居中项，无需读取内部值）
  useEffect(() => {
    const onDbl = (e: MouseEvent) => {
      const picker = (e.target as HTMLElement | null)?.closest?.(".adm-picker");
      if (!picker) return;
      const btns = picker.querySelectorAll<HTMLElement>(".adm-picker-header-button");
      btns[btns.length - 1]?.click();
    };
    document.addEventListener("dblclick", onDbl);
    return () => document.removeEventListener("dblclick", onDbl);
  }, []);

  /** 「我的位置」：定位降级链（GPS→IP 兜底，静默降级不弹提示）+ 飞行到当前点（17 级）。 */
  const locateMe = async () => {
    try {
      const first = await getCurrentPositionWithFallback();
      setMyPos([first.lat, first.lng]);
      mapRef.current?.flyTo(disp([first.lat, first.lng]), 17);
    } catch {
      Toast.show("定位失败，请检查定位权限");
    }
  };

  const stopNav = () => {
    if (watchRef.current) { window.clearInterval(watchRef.current); watchRef.current = null; }
    setNavigating(false);
    setNavInfo("");
  };
  useEffect(() => () => { stopNav(); }, []);

  const startNav = async () => {
    if (!selFaultId) { Toast.show("请先选择故障点"); return; }
    // 初始定位走降级链（浏览器 GPS → IP 兜底，静默降级不弹提示）
    let first;
    try {
      first = await getCurrentPositionWithFallback();
    } catch {
      Toast.show("无法获取定位，请在导航弹窗中「选起点」");
      setPanel("nav");
      setMode("navStart");
      return;
    }
    setNavStart([first.lat, first.lng]);
    setMyPos([first.lat, first.lng]);
    setNavigating(true);
    setNavInfo("正在导航…");
    const apply = (lat: number, lng: number, heading?: number) => {
      setMyPos([lat, lng]);
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
    };
    const tick = () => {
      // 周期刷新仅在原生 Geolocation 可用时进行（IP 定位不做高频轮询，保持初始粗定位）
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const lat = p.coords.latitude;
            const lng = p.coords.longitude;
            let heading: number | undefined;
            if (p.coords.heading != null && !Number.isNaN(p.coords.heading)) heading = p.coords.heading;
            apply(lat, lng, heading);
          },
          () => undefined,
          { enableHighAccuracy: true, maximumAge: 2000 },
        );
      }
    };
    tick();
    watchRef.current = window.setInterval(tick, 1000);
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
      // 定位点飞行至 17 级（与故障定位一致，长线缆远端也能看清落点）
      mapRef.current?.flyTo(disp([r.lat, r.lng]), 17);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "测距失败");
    }
  };

  const openPanel = (key: Exclude<PanelKey, null>) => {
    setPanel((cur) => (cur === key ? null : key));
    if (key === "faults") void load();
  };

  /** 从故障面板行内发起导航：预选该故障并打开导航面板。 */
  const navToFault = (f: FaultItem) => {
    setSelFaultId(f.id);
    setHighlight([f.lat, f.lng]);
    setPanel("nav");
  };

  return (
    <ModuleGate code="map" title="地图">
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* NavBar（OP：‹ 地图 · 右侧「图层」链接） */}
      <NavBar
        onBack={() => navigate(-1)}
        right={
          <span style={{ fontSize: 12, fontWeight: 500, color: "#5B7FFF", padding: "4px 2px" }} onClick={() => setPanel(panel === "layers" ? null : "layers")}>
            图层
          </span>
        }
      >
        地图
      </NavBar>

      {/* 地图区（全屏最大化；左上徽标 + 右上图层钮 + 底部五键工具栏常驻） */}
      <div style={{ flex: 1, position: "relative", minHeight: 0, background: "#DDE7F5", marginBottom: 56 }}>
        <MapContainer ref={mapRef} center={disp(initialCenter)} zoom={12} zoomControl={false} style={{ height: "100%", width: "100%", background: "#DDE7F5" }}>
          <ZoomControl position="bottomright" />
          <TileLayer url={mapApi.tileUrl("esri", "{z}", "{x}", "{y}")} maxZoom={19} attribution="© 卫星影像" />
          <ClickCatcher onPick={(lat, lng) => {
            // 取点模式：选完落针并自动回到对应面板确认；画线模式逐点追加；普通点击不落点
            if (mode === "fault") { setPick({ lat, lng }); setMode("none"); setPanel("report"); }
            else if (mode === "navStart") { setNavStart([lat, lng]); setMode("none"); setPanel("nav"); }
            else if (mode === "draw") { setDraftPts((pts) => [...pts, [lat, lng]]); }
          }} />
          {layers.cables && cables.filter((c) => c.geometry).map((c) => (
            <Polyline key={c.id} positions={(c.geometry!.coordinates as [number, number][]).map(([lng, lat]) => disp([lat, lng]))}
              pathOptions={{ color: "#5B7FFF", weight: 4 }} />
          ))}
          {layers.faults && faults.map((f) => <Marker key={f.id} position={disp([f.lat, f.lng])} icon={warnIcon} />)}
          {layers.devices && devices.map((d) => <Marker key={`d${d.id}`} position={disp([d.lat!, d.lng!])} icon={deviceIcon} />)}
          {myPos && <Marker position={disp(myPos)} icon={myLocationIcon} />}
          {highlight && <Marker position={disp(highlight)} icon={navIcon} />}
          {/* 上报取点 / 导航起点：地图上可见的落针（选点反馈） */}
          {pick && <Marker position={disp([pick.lat, pick.lng])} icon={pickIcon} />}
          {navStart && <Marker position={disp(navStart)} icon={startIcon} />}
          {/* 画线：琥珀折线 + 顶点圆点（临时测量线） */}
          {draftPts.length > 0 && (
            <>
              <Polyline positions={draftPts.map((p) => disp(p))} pathOptions={{ color: "#F59E0B", weight: 4 }} />
              {draftPts.map((p, i) => <Marker key={`v${i}`} position={disp(p)} icon={vertexIcon} />)}
            </>
          )}
          {navPath && navPath.length > 1 && (
            <Polyline positions={navPath.map((p) => disp(p))} pathOptions={{ color: "#EF4444", weight: 5, dashArray: "8 6" }} />
          )}
        </MapContainer>

        {/* 左上徽标（OP Badge 白底胶囊 r999：红点 + 「故障 n · 线缆 m」） */}
        <div
          style={{
            position: "absolute", top: 8, left: 8, zIndex: 1000,
            display: "flex", alignItems: "center", gap: 4,
            background: "#fff", borderRadius: 999, padding: "4px 10px",
            boxShadow: "0 2px 10px rgba(30,36,51,.12)",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 4, background: "#DC2626" }} />
          <span style={{ fontSize: 10.5, fontWeight: 500, color: "#5B6478" }}>故障 {faults.length} · 线缆 {cables.length}</span>
        </div>

        {/* 右上图层按钮（OP LayerBtn 36×36 r12 白底） */}
        <div
          onClick={() => setPanel(panel === "layers" ? null : "layers")}
          style={{
            position: "absolute", top: 8, right: 8, zIndex: 1000, width: 36, height: 36, borderRadius: 12,
            background: "#fff", boxShadow: "0 2px 10px rgba(30,36,51,.12)", display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer",
          }}
        >
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke={panel === "layers" ? "#5B7FFF" : "#5B6478"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l9 5-9 5-9-5 9-5z" />
            <path d="M3 13l9 5 9-5" />
          </svg>
        </div>

        {/* 取点模式提示条（弹层已收起，地图可点；选完自动回到对应面板） */}
        {mode === "fault" && <div style={{ position: "absolute", top: 52, left: 8, background: "#fff", padding: "4px 10px", borderRadius: 8, fontSize: 12, zIndex: 1000, boxShadow: "0 2px 10px rgba(30,36,51,.12)" }}>请点击地图选择故障位置</div>}
        {mode === "navStart" && <div style={{ position: "absolute", top: 52, left: 8, background: "#fff", padding: "4px 10px", borderRadius: 8, fontSize: 12, zIndex: 1000, boxShadow: "0 2px 10px rgba(30,36,51,.12)" }}>请点击地图选择导航起点</div>}
        {navInfo && <div style={{ position: "absolute", bottom: 12, left: 8, right: 8, background: "#fff", padding: 8, borderRadius: 12, fontSize: 14, zIndex: 1000, textAlign: "center", boxShadow: "0 2px 10px rgba(30,36,51,.12)" }}>{navInfo}</div>}
      </div>

      {/* 画线操作条（画线中或已画点时显示，悬于底部工具栏上方；随 .wlt-fixed-bar 宽屏限宽居中） */}
      {(mode === "draw" || draftPts.length > 0) && (() => {
        const total = draftPts.slice(1).reduce((s, p, i) => s + distMeters(draftPts[i], p), 0);
        const miniBtn: React.CSSProperties = { height: 30, padding: "0 12px", borderRadius: 9, border: "1px solid #CBD6EC", background: "#fff", color: "#3B5BDB", fontSize: 12, cursor: "pointer" };
        return (
          <div className="wlt-fixed-bar" style={{ bottom: "calc(50px + env(safe-area-inset-bottom))", justifyContent: "space-between", padding: "8px 12px", zIndex: 899 }}>
            <span style={{ fontSize: 12, fontWeight: mode === "draw" ? 600 : 400, color: mode === "draw" ? "#B45309" : "#5B6478" }}>
              {mode === "draw"
                ? draftPts.length > 0
                  ? `画线中：${draftPts.length} 点 · ${fmtLen(total)}`
                  : "画线：点击地图依次加点"
                : `画线：${draftPts.length} 点 · 总长 ${fmtLen(total)}`}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...miniBtn, opacity: draftPts.length ? 1 : 0.45 }} disabled={!draftPts.length}
                onClick={() => setDraftPts((pts) => pts.slice(0, -1))}>撤销</button>
              <button style={{ ...miniBtn, opacity: draftPts.length ? 1 : 0.45 }} disabled={!draftPts.length}
                onClick={() => setDraftPts([])}>清空</button>
              {mode === "draw" && (
                <button style={{ ...miniBtn, border: "none", background: "#5B7FFF", color: "#fff", fontWeight: 600 }}
                  onClick={() => setMode("none")}>完成</button>
              )}
            </div>
          </div>
        );
      })()}

      {/* 底部六键工具栏（位置/测距/画线/图层/故障/上报；.wlt-fixed-bar 宽屏限宽居中；
          zIndex 低于 Popup，避免遮挡呼出的功能界面） */}
      <div className="wlt-fixed-bar" style={{ justifyContent: "space-around", padding: "6px 8px", zIndex: 900 }}>
        {TOOLS.map((t) => {
          const active = (t.key !== "location" && panel === t.key) || (t.key === "draw" && mode === "draw");
          return (
            <div
              key={t.key}
              onClick={() => {
                if (t.key === "location") void locateMe();
                else if (t.key === "draw") { setPanel(null); setMode((m) => (m === "draw" ? "none" : "draw")); }
                else openPanel(t.key as Exclude<PanelKey, null>);
              }}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                padding: "4px 0", cursor: "pointer",
                color: active ? "#3B5BDB" : "#5B6478",
                minWidth: 48,
              }}
            >
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none"
                stroke={active ? "#3B5BDB" : "#5B6478"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                {t.icon}
              </svg>
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, lineHeight: 1.2 }}>{t.label}</span>
            </div>
          );
        })}
      </div>

      {/* 图层叠加弹层（OP Panel r20：标题行 + 三行 层×开关，圆点 蓝/红/紫） */}
      <Popup visible={panel === "layers"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <div style={{ padding: 16, paddingBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1E2433" }}>图层叠加</span>
            <span style={{ color: "#8A93A8", fontSize: 12 }} onClick={() => setPanel(null)}>收起 ×</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { key: "cables" as const, label: `线缆层（${cables.length}）`, color: "#5B7FFF", radius: 4 },
              { key: "faults" as const, label: `故障层（${faults.length}）`, color: "#DC2626", radius: 4 },
              { key: "devices" as const, label: `设备层（${devices.length}）`, color: "#7C3AED", radius: 1 },
            ].map((l, i) => (
              <div
                key={l.key}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  borderRadius: 10, padding: "7px 8px",
                  background: i === 2 ? "#F6F8FE" : "#EAEFFF",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: l.radius, background: l.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12, color: "#5B6478" }}>{l.label}</span>
                <Switch checked={layers[l.key]} onChange={(v) => setLayers((s) => ({ ...s, [l.key]: v }))} style={{ "--adm-color-checked": "#5B7FFF" } as React.CSSProperties} />
              </div>
            ))}
          </div>
        </div>
      </Popup>

      {/* 上报故障弹层 */}
      <Popup visible={panel === "report"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "75dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1E2433" }}>上报故障</span>
            <span style={{ color: "#8A93A8", fontSize: 12 }} onClick={() => setPanel(null)}>收起 ×</span>
          </div>
          {pick && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FDEBEC", borderRadius: 8, padding: "4px 10px", marginBottom: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: "#DC2626" }} />
              <span style={{ fontSize: 11.5, color: "#DC2626" }}>已选位置 {pick.lat.toFixed(5)}, {pick.lng.toFixed(5)}</span>
            </div>
          )}
          <Button block size="small" fill="outline" color="danger" onClick={() => { setPanel(null); setMode("fault"); }} style={{ marginBottom: 8, borderColor: "#CBD6EC", color: "#DC2626" }}>
            {pick ? "重新选择位置（当前弹层收起，点击地图取点）" : "在地图上选择位置"}
          </Button>
          <Selector options={[{ label: "低", value: 1 }, { label: "中", value: 2 }, { label: "高", value: 3 }]} value={[sev]} onChange={(v) => setSev(v[0] ?? 1)} style={{ marginBottom: 8, "--adm-color-primary": "#5B7FFF" } as React.CSSProperties} />
          <TextArea placeholder="故障描述（可选）" value={desc} onChange={setDesc} rows={2} maxLength={500} style={{ marginBottom: 8, "--background-color": "#F6F8FE" } as React.CSSProperties} />
          <input type="file" accept="image/*" style={{ display: "none" }} id="fault-photo" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <label htmlFor="fault-photo" style={{ display: "inline-block", marginBottom: 8, color: "#3B5BDB", fontSize: 13 }}>{photo ? "已选照片（点击更换）" : "+ 拍照/选择现场照片"}</label>
          <Button block color="danger" loading={reporting} disabled={!pick} onClick={submitFault} style={{ background: "#EF4444", borderColor: "#EF4444" }}>提交故障上报</Button>
        </div>
      </Popup>

      {/* 故障管理弹层（行内 定位/导航/删除；「导航」由此发起） */}
      <Popup visible={panel === "faults"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "75dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1E2433" }}>故障管理（共 {faults.length} 条）</span>
            <span style={{ color: "#3B5BDB", fontSize: 12 }} onClick={() => void load()}>刷新</span>
          </div>
          {faults.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #F2F5FB" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>
                  #{f.id}　{f.fault_type || "未分类"}
                  <span className={`wlt-pill ${f.severity === 3 ? "wlt-pill--red" : f.severity === 2 ? "wlt-pill--amber" : "wlt-pill--gray"}`} style={{ marginLeft: 6, fontSize: 10.5, lineHeight: "16px", padding: "0 8px" }}>
                    {["低", "中", "高"][f.severity - 1] ?? f.severity}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#8A93A8" }}>{f.lat.toFixed(5)}, {f.lng.toFixed(5)}　{FAULT_STATUS[f.status] ?? f.status}</div>
              </div>
              <Button size="mini" color="primary" fill="outline" onClick={() => { setHighlight([f.lat, f.lng]); setPanel(null); mapRef.current?.flyTo(disp([f.lat, f.lng]), 17); }} style={{ color: "#3B5BDB", borderColor: "#CBD6EC" }}>定位</Button>
              <Button size="mini" color="primary" fill="outline" onClick={() => navToFault(f)} style={{ color: "#3B5BDB", borderColor: "#CBD6EC" }}>导航</Button>
              <Button size="mini" color="danger" fill="outline" onClick={() => deleteFault(f)} style={{ color: "#DC2626", borderColor: "#CBD6EC" }}>删除</Button>
            </div>
          ))}
          {faults.length === 0 && <div style={{ textAlign: "center", color: "#8A93A8", padding: 16 }}>暂无故障</div>}
        </div>
      </Popup>

      {/* 测距定位弹层 */}
      <Popup visible={panel === "measure"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "60dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1E2433" }}>测距定位</span>
            <span style={{ color: "#8A93A8", fontSize: 12 }} onClick={() => setPanel(null)}>收起 ×</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* antd-mobile v5 Picker 不向子元素注入点击事件：须经 render-prop 第二参 actions 开关 */}
            <Picker
              title="选择线缆（双击选项可直接确定）"
              columns={[cables.filter((c) => c.status === 1).map((c) => ({ label: `${c.name}（${Math.round(c.total_length)}m）`, value: c.id }))]}
              value={selCableId ? [selCableId] : undefined}
              onConfirm={(v) => setSelCableId(v[0] as number)}
            >
              {(items, actions) => (
                <Button size="small" fill="outline" style={{ color: "#3B5BDB", borderColor: "#CBD6EC" }} onClick={() => actions.open()}>
                  {items[0]?.label ?? "选择线缆"}
                </Button>
              )}
            </Picker>
            <Input placeholder="距离(m)" type="number" value={distance} onChange={setDistance} style={{ flex: 1 }} />
            <Button size="small" color="primary" onClick={doMeasure} style={{ background: "#5B7FFF", borderColor: "#5B7FFF" }}>定位</Button>
          </div>
          {measureResult && (
            <div style={{ fontSize: 12, color: "#5B6478", marginTop: 8 }}>
              定位点 {measureResult.lat.toFixed(6)}, {measureResult.lng.toFixed(6)}　累计 {measureResult.cumulative_distance.toFixed(1)}m
              {measureResult.nearest_marker && `　最近：${measureResult.nearest_marker.label}（${measureResult.nearest_marker.distance.toFixed(1)}m）`}
            </div>
          )}
        </div>
      </Popup>

      {/* 故障导航弹层（由故障面板行内「导航」进入，已预选故障） */}
      <Popup visible={panel === "nav"} onMaskClick={() => setPanel(null)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "60dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1E2433" }}>故障导航</span>
            <span style={{ color: "#8A93A8", fontSize: 12 }} onClick={() => setPanel(null)}>收起 ×</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* 同测距：Picker 需经 actions.open() 打开 */}
            <Picker
              title="选择故障点（双击选项可直接确定）"
              columns={[faults.map((f) => ({ label: `#${f.id} ${f.fault_type || "故障"}（${f.description?.slice(0, 10) || ""}）`, value: f.id }))]}
              value={selFaultId ? [selFaultId] : undefined}
              onConfirm={(v) => setSelFaultId(v[0] as number)}
            >
              {(items, actions) => (
                <Button size="small" fill="outline" style={{ color: "#3B5BDB", borderColor: "#CBD6EC" }} onClick={() => actions.open()}>
                  {items[0]?.label ?? "选择故障点"}
                </Button>
              )}
            </Picker>
            <Button size="small" fill="outline" onClick={() => { setPanel(null); setMode("navStart"); }} style={{ color: "#3B5BDB", borderColor: "#CBD6EC" }}>
              选起点
            </Button>
          </div>
          {navStart && <div style={{ fontSize: 12, color: "#8A93A8", marginTop: 6 }}>起点 {navStart[0].toFixed(6)}, {navStart[1].toFixed(6)}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button block color="primary" size="small" onClick={startNav} disabled={!selFaultId} style={{ background: "#5B7FFF", borderColor: "#5B7FFF" }}>{navigating ? "导航中…" : "开始导航"}</Button>
            <Button block size="small" fill="outline" onClick={stopNav} style={{ color: "#5B6478", borderColor: "#CBD6EC" }}>停止</Button>
          </div>
        </div>
      </Popup>
    </div>
    </ModuleGate>
  );
}
