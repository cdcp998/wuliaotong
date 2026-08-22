/** 手机端：设备（方案 §7.3）——列表（定位/状态/首图）+ 新增设备（定位获取经纬度 + 图片上传可选）。 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Form, Input, List, NavBar, Popup, Tag, Toast } from "antd-mobile";

import { ModuleGate } from "../../components/ModuleGate";
import { DEVICE_STATUS, deviceApi, type DeviceItem } from "../api";

interface DraftFile {
  file: File;
  preview: string;
}

export function MobileDevicesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DeviceItem[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");
  const [locInfo, setLocInfo] = useState("");
  const [photos, setPhotos] = useState<DraftFile[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const r = await deviceApi.list({ page_size: 100 });
      setRows(r.items);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const locate = () => {
    setLocating(true);
    setLocInfo("定位中…");
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(7));
        setLng(pos.coords.longitude.toFixed(7));
        setLocInfo(`定位成功（精度 ±${Math.round(pos.coords.accuracy ?? 0)}m，WGS84）`);
        setLocating(false);
      },
      () => { Toast.show("无法获取定位，请手动输入坐标"); setLocInfo(""); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const r = await deviceApi.create({
        code: v.code, name: v.name, model: v.model ?? "", category: v.category ?? "",
        location: v.location ?? "", lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null,
        status: 1,
      });
      // 上传图片（可选，最多 3 张）
      if (photos.length) {
        const { fileApi } = await import("@wlt/shared");
        for (const p of photos) {
          try {
            const up = await fileApi.upload(p.file, "device");
            await deviceApi.addDeviceFile(r.id, up.file_id);
          } catch {
            Toast.show("部分图片上传失败（设备已保存）");
            break;
          }
        }
      }
      Toast.show("设备已添加");
      setOpen(false);
      form.resetFields();
      setLat(""); setLng(""); setLocInfo(""); setPhotos([]);
      void load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "添加失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModuleGate code="device" title="设备">
    <div style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar onBack={() => navigate(-1)} right={
        <Button size="mini" color="primary" onClick={() => { form.resetFields(); setLat(""); setLng(""); setLocInfo(""); setPhotos([]); setOpen(true); }}>+ 添加</Button>
      }>设备</NavBar>
      <List style={{ minHeight: "70dvh" }}>
        {rows.map((d) => (
          <List.Item key={d.id} description={`${d.model || "—"}　${d.location || (d.lat ? `${d.lat.toFixed(5)}, ${d.lng?.toFixed(5)}` : "未定位")}`}
            prefix={
              d.cover_file_id ? (
                <img src={`/api/v1/files/${d.cover_file_id}`} width={44} height={44} style={{ borderRadius: 8, objectFit: "cover" }} alt="" />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 8, background: "#EAEFFF", color: "#5B7FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📷</div>
              )
            }>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{d.name}（{d.code}）</span>
              <Tag color={d.status === 1 ? "success" : d.status === 2 ? "warning" : d.status === 4 ? "danger" : "default"}>{DEVICE_STATUS[d.status]}</Tag>
            </div>
          </List.Item>
        ))}
        {rows.length === 0 && <List.Item>暂无设备</List.Item>}
      </List>

      <Popup visible={open} onMaskClick={() => setOpen(false)} bodyStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "88dvh", overflow: "auto" }}>
        <div style={{ padding: 16, paddingBottom: 28 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>添加设备</div>
          <Form form={form} layout="vertical" style={{ "--border-bottom": "none" } as React.CSSProperties}>
            <Form.Item name="code" label="设备编码" rules={[{ required: true, message: "请输入编码" }]}>
              <Input placeholder="如 SB-001" />
            </Form.Item>
            <Form.Item name="name" label="设备名称" rules={[{ required: true, message: "请输入名称" }]}>
              <Input placeholder="如 熔接机 FSM-80S" />
            </Form.Item>
            <Form.Item name="model" label="型号/规格">
              <Input />
            </Form.Item>
            <Form.Item name="category" label="类别">
              <Input placeholder="如 熔接设备" />
            </Form.Item>
            <Form.Item name="location" label="物理位置">
              <Input placeholder="如 一号机房" />
            </Form.Item>
            <Form.Item label="经纬度（WGS84，可选）">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Input placeholder="纬度" value={lat} onChange={setLat} style={{ flex: 1 }} />
                <Input placeholder="经度" value={lng} onChange={setLng} style={{ flex: 1 }} />
                <Button size="small" color="primary" fill="outline" loading={locating} onClick={locate}>定位获取</Button>
              </div>
              {locInfo && <div style={{ fontSize: 11, color: "#5B7FFF", marginTop: 4 }}>{locInfo}</div>}
            </Form.Item>
            <Form.Item label="设备图片（可选，最多 3 张）">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img src={p.preview} width={64} height={64} style={{ borderRadius: 8, objectFit: "cover" }} alt="" />
                    <span onClick={() => setPhotos((ps) => ps.filter((_, x) => x !== i))}
                      style={{ position: "absolute", top: -6, right: -6, background: "#EF4444", color: "#fff", borderRadius: 10, width: 18, height: 18, fontSize: 11, lineHeight: "18px", textAlign: "center" }}>×</span>
                  </div>
                ))}
                {photos.length < 3 && (
                  <label htmlFor="device-photo" style={{ width: 64, height: 64, border: "1px dashed #bbb", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 22 }}>＋</label>
                )}
                <input id="device-photo" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && photos.length < 3) {
                    setPhotos((ps) => [...ps, { file: f, preview: URL.createObjectURL(f) }]);
                  }
                  e.target.value = "";
                }} />
              </div>
            </Form.Item>
          </Form>
          <Button block color="primary" loading={submitting} onClick={submit} style={{ marginTop: 8, height: 44, borderRadius: 10 }}>保存设备</Button>
        </div>
      </Popup>
    </div>
    </ModuleGate>
  );
}
