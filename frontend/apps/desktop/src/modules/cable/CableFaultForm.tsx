/** cable 模块：线缆故障上报表单（可复用）。
 *  供两处嵌入：①「故障管理」页上报弹窗；②任务管理「发布任务」弹窗的线缆任务标签页
 *  （跨模块直接调用本模块的上报界面，需求 2）。提交生成 CableFault；
 *  调用方可在 onSubmitted(faultId) 中追加联动（如自动生成维修任务）。 */
import { useEffect, useState } from "react";
import { App, Button, Form, Input, Radio, Select, Upload } from "antd";
import { AimOutlined, UploadOutlined } from "@ant-design/icons";

import { fileApi } from "@wlt/shared";

import { cableApi, type CableItem } from "./api";
import { mapApi, type MapSourceInfo } from "../map/api";
import { MapView } from "../map/MapView";

const SEVERITY: Record<number, { label: string }> = { 1: { label: "低" }, 2: { label: "中" }, 3: { label: "高" } };

export function CableFaultForm({ onSubmitted, onCancel }: {
  /** 上报成功回调（参数为新建 fault id；父级负责关弹窗/后续联动）。 */
  onSubmitted?: (faultId: number) => void;
  onCancel?: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [sources, setSources] = useState<Record<string, MapSourceInfo>>({});
  const [cables, setCables] = useState<CableItem[]>([]);

  useEffect(() => {
    mapApi.mapSources().then((s) => setSources(s.map_sources)).catch(() => undefined);
    cableApi.listCables({ page_size: 100 }).then((r) => setCables(r.items)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const values = await form.validateFields();
    if (!picked) {
      message.warning("请在地图上点击选择故障位置");
      return;
    }
    setSaving(true);
    try {
      const r = await cableApi.createFault({
        cable_id: values.cable_id ?? null,
        lat: picked.lat,
        lng: picked.lng,
        fault_type: values.fault_type ?? "",
        severity: values.severity,
        description: values.description ?? "",
      });
      if (values.photoFile) {
        try {
          const up = await fileApi.upload(values.photoFile, "fault");
          await cableApi.addFaultPhoto(r.id, up.file_id, "现场");
        } catch {
          message.warning("照片上传失败（故障已上报，可稍后补充）");
        }
      }
      message.success("故障已上报");
      form.resetFields();
      setPicked(null);
      onSubmitted?.(r.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上报失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
      <Form.Item name="cable_id" label="关联线缆（可选）" style={{ marginBottom: 12 }}>
        <Select allowClear showSearch optionFilterProp="label" placeholder="选择发生故障的线缆"
          options={cables.filter((c) => c.status === 1).map((c) => ({ value: c.id, label: `${c.name}（${c.code}）` }))} />
      </Form.Item>
      <Form.Item name="fault_type" label="故障类型" style={{ marginBottom: 12 }}>
        <Input maxLength={30} placeholder="如 断芯 / 接头进水 / 外破" />
      </Form.Item>
      <Form.Item name="severity" label="严重度" rules={[{ required: true }]} initialValue={2} style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" buttonStyle="solid" style={{ display: "flex" }}>
          {Object.entries(SEVERITY).map(([k, v]) => <Radio.Button key={k} value={Number(k)} style={{ flex: 1, textAlign: "center", borderRadius: 10 }}>{v.label}</Radio.Button>)}
        </Radio.Group>
      </Form.Item>
      <Form.Item name="description" label="描述" style={{ marginBottom: 12 }}>
        <Input.TextArea rows={3} maxLength={500} placeholder="故障现象、影响范围、现场情况…" />
      </Form.Item>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#5B6478", marginBottom: 6 }}>故障位置（点击地图选点）</div>
      <div style={{ height: 220, borderRadius: 12, overflow: "hidden", border: "1px solid #E4EAF6", marginBottom: 8 }}>
        <MapView sources={sources} overlays={{ cables: [], faults: [], markersByCable: {} }}
          onPick={(lat, lng) => { setPicked({ lat, lng }); setPicking(false); }}
          picking={picking ? "点击地图选择故障位置（自动转换为 WGS84）" : undefined} height="220px" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Button size="small" icon={<AimOutlined />} onClick={() => setPicking(true)}>地图选点</Button>
        {picked && <span style={{ fontSize: 11.5, color: "#5B6478", fontVariantNumeric: "tabular-nums" }}>已选：{picked.lat.toFixed(6)}, {picked.lng.toFixed(6)}</span>}
        {!picked && <span style={{ fontSize: 11.5, color: "#6A748A" }}>尚未选择位置</span>}
      </div>
      <Form.Item name="photoFile" label="现场照片（可选）" valuePropName="file" getValueFromEvent={(e) => e?.fileList?.[0]?.originFileObj} style={{ marginBottom: 0 }}>
        <Upload beforeUpload={() => false} maxCount={1} accept="image/*">
          <Button icon={<UploadOutlined />} block>选择照片</Button>
        </Upload>
      </Form.Item>
      <div style={{ display: "flex", gap: 10, marginTop: 14, borderTop: "1px solid #E4EAF6", paddingTop: 12 }}>
        <Button style={{ width: 120 }} onClick={onCancel}>取消</Button>
        <Button type="primary" loading={saving} style={{ flex: 1 }} onClick={() => void submit()}>提交上报</Button>
      </div>
    </Form>
  );
}
