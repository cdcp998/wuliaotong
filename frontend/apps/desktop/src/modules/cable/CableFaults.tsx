/** cable 模块：故障管理（/cable/faults，fault:manage / fault:report）——上报、状态流转、照片。 */
import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Form, Image, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography, Upload } from "antd";
import { AimOutlined, CameraOutlined, CheckCircleOutlined, CheckOutlined, DeleteOutlined, LockOutlined, PlayCircleOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";

import { baseApi, fileApi } from "@wlt/shared";

import { cableApi, type CableItem, type FaultItem, type MapSourceInfo } from "./api";
import { MapView } from "./MapView";

/** 状态推进动作 → 图标（操作列图标化，tooltip 提示）。 */
const NEXT_ICON: Record<number, React.ReactNode> = {
  1: <PlayCircleOutlined />,
  2: <CheckCircleOutlined />,
  3: <CheckOutlined />,
  4: <LockOutlined />,
};

const SEVERITY: Record<number, { label: string; color: string }> = {
  1: { label: "低", color: "default" },
  2: { label: "中", color: "orange" },
  3: { label: "高", color: "red" },
};
const STATUS: Record<number, { label: string; color: string; next?: { to: number; label: string } }> = {
  0: { label: "待处理", color: "red", next: { to: 1, label: "开始处理" } },
  1: { label: "处理中", color: "processing", next: { to: 2, label: "提交验证" } },
  2: { label: "待验证", color: "warning", next: { to: 3, label: "修复完成" } },
  3: { label: "已修复", color: "success", next: { to: 4, label: "关闭" } },
  4: { label: "已关闭", color: "default" },
};

interface PhotoItem {
  id: number;
  file_id: number;
  category: string;
  remark: string;
  url: string;
}

export function CableFaultsPage() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<FaultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [sources, setSources] = useState<Record<string, MapSourceInfo>>({});
  const [cables, setCables] = useState<CableItem[]>([]);
  const [detail, setDetail] = useState<FaultItem | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [locFault, setLocFault] = useState<FaultItem | null>(null);
  const [delFault, setDelFault] = useState<FaultItem | null>(null);
  const [delReason, setDelReason] = useState("");
  const [delSubmitting, setDelSubmitting] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await cableApi.listFaults({ status: filterStatus, severity: filterSeverity, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载故障列表失败");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSeverity, page, pageSize, message]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    cableApi.mapSources().then((s) => setSources(s.map_sources)).catch(() => undefined);
    cableApi.listCables({ page_size: 100 }).then((r) => setCables(r.items)).catch(() => undefined);
  }, []);

  const openCreate = () => {
    setPicked(null);
    form.resetFields();
    form.setFieldsValue({ severity: 1 });
    setOpen(true);
  };

  const save = async () => {
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
      message.success("故障已上报");
      setOpen(false);
      void load();
      if (values.photoFile) {
        // 上传照片并关联（失败不阻断主流程）
        try {
          const up = await fileApi.upload(values.photoFile, "fault");
          await cableApi.addFaultPhoto(r.id, up.file_id, "现场");
        } catch {
          message.warning("照片上传失败（故障已上报，可稍后补充）");
        }
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上报失败");
    } finally {
      setSaving(false);
    }
  };

  const nextStatus = async (f: FaultItem) => {
    const meta = STATUS[f.status];
    if (!meta?.next) return;
    try {
      await cableApi.updateFaultStatus(f.id, meta.next.to);
      message.success(`状态已更新为「${STATUS[meta.next.to].label}」`);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const removeFault = async (f: FaultItem) => {
    try {
      await cableApi.deleteFault(f.id);
      message.success("故障已删除（软删除，列表与地图均不再显示）");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const submitDelReview = async () => {
    if (!delFault) return;
    if (!delReason.trim()) {
      message.warning("请填写删除原因");
      return;
    }
    setDelSubmitting(true);
    try {
      await baseApi.submitDeleteReview({ biz_type: "fault", target_id: delFault.id, reason: delReason.trim() });
      message.success("已提交删除申请，待管理员审核（可在「系统管理 → 删除审核」查看进度）");
      setDelFault(null);
      setDelReason("");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setDelSubmitting(false);
    }
  };

  const openDetail = async (f: FaultItem) => {
    setDetail(f);
    setPhotos([]);
    try {
      setPhotos(await cableApi.listFaultPhotos(f.id));
    } catch {
      setPhotos([]);
    }
  };

  const uploadPhoto = async (file: File) => {
    if (!detail) return;
    try {
      const up = await fileApi.upload(file, "fault");
      await cableApi.addFaultPhoto(detail.id, up.file_id, "维修后");
      setPhotos(await cableApi.listFaultPhotos(detail.id));
      message.success("照片已上传");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    }
    return false;
  };

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>故障管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>故障上报</Button>
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <Select placeholder="状态" allowClear style={{ width: 140 }} value={filterStatus || undefined} onChange={(v) => { setFilterStatus(v ?? ""); setPage(1); }}
          options={Object.entries(STATUS).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
        <Select placeholder="严重度" allowClear style={{ width: 140 }} value={filterSeverity || undefined} onChange={(v) => { setFilterSeverity(v ?? ""); setPage(1); }}
          options={Object.entries(SEVERITY).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
      </Space>
      <Table<FaultItem>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        columns={[
          { title: "#", dataIndex: "id", width: 60 },
          { title: "类型", dataIndex: "fault_type", width: 110, render: (v: string) => v || "—" },
          { title: "严重度", dataIndex: "severity", width: 90, render: (v: number) => <Tag color={SEVERITY[v]?.color}>{SEVERITY[v]?.label ?? v}</Tag> },
          { title: "位置", key: "pos", width: 190, render: (_, f) => `${f.lat.toFixed(6)}, ${f.lng.toFixed(6)}` },
          { title: "累计距离", dataIndex: "cumulative_distance", width: 110, render: (v: number) => (v > 0 ? `${v.toFixed(1)} m` : "—") },
          { title: "描述", dataIndex: "description", ellipsis: true },
          { title: "状态", dataIndex: "status", width: 100, render: (v: number) => <Tag color={STATUS[v]?.color}>{STATUS[v]?.label ?? v}</Tag> },
          { title: "上报时间", dataIndex: "reported_at", width: 160, render: (v: string) => (v ? new Date(v).toLocaleString() : "—") },
          {
            title: "操作",
            width: 200,
            render: (_, f) => (
              <Space size={2}>
                {STATUS[f.status]?.next && (
                  <Tooltip title={STATUS[f.status]!.next!.label}>
                    <Button size="small" type="primary" icon={NEXT_ICON[STATUS[f.status]!.next!.to]} onClick={() => nextStatus(f)} />
                  </Tooltip>
                )}
                <Tooltip title="定位到故障点">
                  <Button size="small" icon={<AimOutlined />} onClick={() => setLocFault(f)} />
                </Tooltip>
                <Tooltip title="照片/详情">
                  <Button size="small" icon={<CameraOutlined />} onClick={() => openDetail(f)} />
                </Tooltip>
                {f.status === 4 ? (
                  <Tooltip title="删除（已关闭故障，需管理员审核）">
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setDelFault(f); setDelReason(""); }} />
                  </Tooltip>
                ) : (
                  <Popconfirm title={`确认删除故障 #${f.id}？删除后列表与地图均不再显示。`} onConfirm={() => removeFault(f)}>
                    <Tooltip title="删除">
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Tooltip>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} title="故障上报" width={720} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Space>
            <Form.Item name="cable_id" label="关联线缆（可选）">
              <Select style={{ width: 260 }} allowClear options={cables.filter((c) => c.status === 1).map((c) => ({ value: c.id, label: c.name }))} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="fault_type" label="故障类型">
              <Input style={{ width: 180 }} maxLength={30} placeholder="如 断芯/接头进水" />
            </Form.Item>
            <Form.Item name="severity" label="严重度" rules={[{ required: true }]}>
              <Select style={{ width: 110 }} options={Object.entries(SEVERITY).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item name="photoFile" label="现场照片（可选）" valuePropName="file" getValueFromEvent={(e) => e?.fileList?.[0]?.originFileObj}>
            <Upload beforeUpload={() => false} maxCount={1} accept="image/*">
              <Button icon={<UploadOutlined />}>选择照片</Button>
            </Upload>
          </Form.Item>
        </Form>
        <Typography.Text strong>故障位置（点击地图选点）</Typography.Text>
        <div style={{ height: 280, margin: "8px 0", border: "1px solid #e5e6eb", borderRadius: 6, overflow: "hidden" }}>
          <MapView
            sources={sources}
            overlays={{ cables: [], faults: [], markersByCable: {} }}
            onPick={(lat, lng) => { setPicked({ lat, lng }); setPicking(false); }}
            picking={picking ? "点击地图选择故障位置（自动转换为 WGS84）" : undefined}
            height="280px"
          />
        </div>
        <Space>
          <Button onClick={() => setPicking(true)}>地图选点</Button>
          {picked && (
            <Typography.Text type="secondary">
              已选：{picked.lat.toFixed(6)}, {picked.lng.toFixed(6)}
            </Typography.Text>
          )}
        </Space>
      </Modal>

      {/* 定位到故障点（内嵌地图） */}
      <Modal open={!!locFault} onCancel={() => setLocFault(null)} footer={null} title={locFault ? `故障 #${locFault.id} 位置` : ""} width={720} destroyOnHidden>
        {locFault && (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {locFault.fault_type || "未分类"} · 状态：{STATUS[locFault.status]?.label} · {locFault.lat.toFixed(6)}, {locFault.lng.toFixed(6)}
            </Typography.Paragraph>
            <div style={{ height: 420, border: "1px solid #e5e6eb", borderRadius: 6, overflow: "hidden" }}>
              <MapView
                sources={sources}
                center={[locFault.lat, locFault.lng]}
                zoom={16}
                overlays={{ cables: [], faults: [locFault], markersByCable: {} }}
                height="420px"
              />
            </div>
          </>
        )}
      </Modal>

      {/* 已关闭故障删除 → 提交管理员审核 */}
      <Modal
        open={!!delFault}
        onCancel={() => setDelFault(null)}
        onOk={submitDelReview}
        confirmLoading={delSubmitting}
        title={delFault ? `删除故障 #${delFault.id}（需管理员审核）` : ""}
        width={520}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          已关闭的故障删除需管理员审核：提交申请并通知管理者，审核通过后才会从列表与地图移除（数据保留可追溯，申请进度可在「系统管理 → 删除审核」查看）。
        </Typography.Paragraph>
        <Input.TextArea rows={3} maxLength={500} placeholder="请填写删除原因（必填）" value={delReason} onChange={(e) => setDelReason(e.target.value)} />
      </Modal>

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        width={520}
        title={detail ? `故障 #${detail.id}` : ""}
      >
        {detail && (
          <>
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              <Typography.Text>
                类型：{detail.fault_type || "—"}　　严重度：<Tag color={SEVERITY[detail.severity]?.color}>{SEVERITY[detail.severity]?.label}</Tag>　　状态：<Tag color={STATUS[detail.status]?.color}>{STATUS[detail.status]?.label}</Tag>
              </Typography.Text>
              <Typography.Text>位置：{detail.lat.toFixed(6)}, {detail.lng.toFixed(6)}（累计 {detail.cumulative_distance.toFixed(1)} m）</Typography.Text>
              <Typography.Paragraph>描述：{detail.description || "—"}</Typography.Paragraph>
              <Typography.Text strong>照片（{photos.length}）</Typography.Text>
              <Space wrap>
                {photos.map((p) => (
                  <Image key={p.id} src={p.url} width={120} height={90} style={{ objectFit: "cover" }} alt={p.category} />
                ))}
              </Space>
              <Upload showUploadList={false} beforeUpload={uploadPhoto} accept="image/*">
                <Button icon={<UploadOutlined />}>补充照片（维修后）</Button>
              </Upload>
            </Space>
          </>
        )}
      </Drawer>
    </div>
  );
}
