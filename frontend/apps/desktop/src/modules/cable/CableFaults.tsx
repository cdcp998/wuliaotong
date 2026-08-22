/** cable 模块：故障管理（/cable/faults，fault:manage / fault:report）——上报、状态流转、照片、删除审核。
 *  v2 界面：状态角标 Tabs + 玻璃表格 + 右侧「故障上报」玻璃面板（与设计稿一致）。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Drawer, Form, Image, Input, Modal, Popconfirm, Radio, Select, Space, Table, Tag, Tooltip, theme, Upload } from "antd";
import { AimOutlined, CameraOutlined, CheckCircleOutlined, CheckOutlined, DeleteOutlined, LockOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, UploadOutlined, WarningOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { baseApi, fileApi } from "@wlt/shared";

import { cableApi, type CableItem, type FaultItem } from "./api";
import { mapApi, type MapSourceInfo } from "../map/api";
import { MapView } from "../map/MapView";

const NEXT_ICON: Record<number, React.ReactNode> = {
  1: <PlayCircleOutlined />,
  2: <CheckCircleOutlined />,
  3: <CheckOutlined />,
  4: <LockOutlined />,
};

const SEVERITY: Record<number, { label: string; fg: string; bg: string }> = {
  1: { label: "低", fg: "#7C3AED", bg: "#F3E8FF" },
  2: { label: "中", fg: "#B45309", bg: "#FEF4E2" },
  3: { label: "高", fg: "#DC2626", bg: "#FDEBEC" },
};
const STATUS: Record<number, { label: string; fg: string; bg: string; next?: { to: number; label: string } }> = {
  0: { label: "待处理", fg: "#DC2626", bg: "#FDEBEC", next: { to: 1, label: "开始处理" } },
  1: { label: "处理中", fg: "#3B5BDB", bg: "#EAEFFF", next: { to: 2, label: "提交验证" } },
  2: { label: "待验证", fg: "#B45309", bg: "#FEF4E2", next: { to: 3, label: "修复完成" } },
  3: { label: "已修复", fg: "#15803D", bg: "#E8F9EF", next: { to: 4, label: "关闭" } },
  4: { label: "已关闭", fg: "#8A93A8", bg: "#EFF3FC" },
};

interface PhotoItem { id: number; file_id: number; category: string; remark: string; url: string }

export function CableFaultsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [rows, setRows] = useState<FaultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    mapApi.mapSources().then((s) => setSources(s.map_sources)).catch(() => undefined);
    cableApi.listCables({ page_size: 100 }).then((r) => setCables(r.items)).catch(() => undefined);
    Promise.all([["", "全部"], ["0", "待处理"], ["1", "处理中"], ["2", "待验证"], ["3", "已修复"], ["4", "已关闭"]].map(async ([st]) => {
      try {
        const r = await cableApi.listFaults({ status: st, page: 1, page_size: 1 });
        return [st, r.total] as const;
      } catch { return [st, 0] as const; }
    })).then((cs) => setCounts(Object.fromEntries(cs)));
  }, []);

  const openCreate = () => {
    setPicked(null);
    form.resetFields();
    form.setFieldsValue({ severity: 2 });
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

  const columns = useMemo<ColumnsType<FaultItem>>(
    () => [
      { title: "故障 / 类型", width: 300, render: (_, f) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{f.description || "未填写描述"}</div>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{f.fault_type || "未分类"} · #{f.id} {f.cumulative_distance > 0 ? `· 距起点 ${f.cumulative_distance.toFixed(0)} m` : ""}</div>
        </div>
      ) },
      { title: "严重度", width: 100, render: (_, f) => { const s = SEVERITY[f.severity]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? f.severity}</Tag>; } },
      { title: "位置", width: 200, render: (_, f) => <span style={{ fontSize: 12, color: token.colorTextSecondary, fontVariantNumeric: "tabular-nums" }}>{f.lat.toFixed(6)}, {f.lng.toFixed(6)}</span> },
      { title: "状态", width: 110, render: (_, f) => { const s = STATUS[f.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? f.status}</Tag>; } },
      { title: "上报时间", dataIndex: "reported_at", width: 150, render: (v: string) => (v ? <span style={{ fontSize: 12 }}>{new Date(v).toLocaleString()}</span> : <span style={{ color: token.colorTextTertiary }}>—</span>) },
      {
        title: "操作", width: 190,
        render: (_, f) => (
          <Space size={2}>
            {STATUS[f.status]?.next && (
              <Tooltip title={STATUS[f.status]!.next!.label}>
                <Button size="small" type="primary" icon={NEXT_ICON[STATUS[f.status]!.next!.to]} onClick={() => nextStatus(f)} />
              </Tooltip>
            )}
            <Tooltip title="定位到故障点"><Button size="small" icon={<AimOutlined />} onClick={() => setLocFault(f)} /></Tooltip>
            <Tooltip title="照片/详情"><Button size="small" icon={<CameraOutlined />} onClick={() => openDetail(f)} /></Tooltip>
            {f.status === 4 ? (
              <Tooltip title="删除（已关闭故障，需管理员审核）">
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setDelFault(f); setDelReason(""); }} />
              </Tooltip>
            ) : (
              <Popconfirm title={`确认删除故障 #${f.id}？删除后列表与地图均不再显示。`} onConfirm={() => removeFault(f)}>
                <Tooltip title="删除"><Button size="small" danger icon={<DeleteOutlined />} /></Tooltip>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [token]
  );

  return (
    <div style={{ padding: 24, maxWidth: 1480, margin: "0 auto" }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>故障管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>故障全生命周期：上报 → 派单 → 修复 → 验收；高严重度自动通知并在地图标红</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>故障上报</Button>
        </Space>
      </div>

      {/* 状态 Tabs + 严重度 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {[["", "全部"], ["0", "待处理"], ["1", "处理中"], ["2", "待验证"], ["3", "已修复"], ["4", "已关闭"]].map(([st, label]) => {
          const active = filterStatus === st;
          return (
            <button key={st} type="button" onClick={() => { setFilterStatus(st); setPage(1); }}
              style={{ cursor: "pointer", border: `1px solid ${active ? "#5B7FFF" : token.colorBorder}`, background: active ? "#5B7FFF" : "#fff", color: active ? "#fff" : token.colorTextSecondary, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: active ? 600 : 500, display: "inline-flex", gap: 6, alignItems: "center", fontFamily: "inherit", transition: "all .2s ease" }}>
              {label} <span style={{ opacity: 0.75, fontWeight: 600 }}>{counts[st] ?? "…"}</span>
            </button>
          );
        })}
        <Select placeholder="全部严重度" allowClear style={{ width: 140, marginLeft: "auto" }} value={filterSeverity || undefined}
          onChange={(v) => { setFilterSeverity(v ?? ""); setPage(1); }}
          options={Object.entries(SEVERITY).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* 左：表格 */}
        <div className="wlt-glass" style={{ flex: 1, minWidth: 320, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 10px" }}>
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>共 {total} 条故障记录</span>
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          </div>
          <Table<FaultItem>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            locale={{ emptyText: "暂无故障" }}
            pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); } }}
            columns={columns}
          />
        </div>

        {/* 右：故障上报面板 */}
        <div className="wlt-glass" style={{ width: 396, padding: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>故障上报</span>
            <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }} color="blue">新报</Tag>
          </div>
          {!open ? (
            <div style={{ textAlign: "center", padding: "40px 12px", color: token.colorTextTertiary, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <WarningOutlined style={{ fontSize: 36, color: "#CBD6EC" }} />
              <div style={{ fontWeight: 600 }}>上报新故障</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>选择线缆 → 地图点选位置 → 填严重度与描述 → 提交后通知调度员；中高严重度同步推送短信</div>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>故障上报</Button>
            </div>
          ) : (
            <Form form={form} layout="vertical" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <Form.Item name="cable_id" label="关联线缆（可选）" style={{ marginBottom: 12 }}>
                <Select allowClear showSearch optionFilterProp="label"
                  options={cables.filter((c) => c.status === 1).map((c) => ({ value: c.id, label: `${c.name}（${c.code}）` }))} />
              </Form.Item>
              <Form.Item name="fault_type" label="故障类型" style={{ marginBottom: 12 }}>
                <Input maxLength={30} placeholder="如 断芯 / 接头进水 / 外破" />
              </Form.Item>
              <Form.Item name="severity" label="严重度" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <Radio.Group optionType="button" buttonStyle="solid" style={{ display: "flex" }}>
                  {Object.entries(SEVERITY).map(([k, v]) => <Radio.Button key={k} value={Number(k)} style={{ flex: 1, textAlign: "center", borderRadius: 10 }}>{v.label}</Radio.Button>)}
                </Radio.Group>
              </Form.Item>
              <Form.Item name="description" label="描述" style={{ marginBottom: 12 }}>
                <Input.TextArea rows={3} maxLength={500} placeholder="故障现象、影响范围、现场情况…" />
              </Form.Item>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary, marginBottom: 6 }}>故障位置（点击地图选点）</div>
              <div style={{ height: 200, borderRadius: 12, overflow: "hidden", border: `1px solid ${token.colorBorder}`, marginBottom: 8 }}>
                <MapView sources={sources} overlays={{ cables: [], faults: [], markersByCable: {} }}
                  onPick={(lat, lng) => { setPicked({ lat, lng }); setPicking(false); }}
                  picking={picking ? "点击地图选择故障位置（自动转换为 WGS84）" : undefined} height="200px" />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Button size="small" icon={<AimOutlined />} onClick={() => setPicking(true)}>地图选点</Button>
                {picked && <span style={{ fontSize: 11.5, color: token.colorTextSecondary, fontVariantNumeric: "tabular-nums" }}>已选：{picked.lat.toFixed(6)}, {picked.lng.toFixed(6)}</span>}
                {!picked && <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>尚未选择位置</span>}
              </div>
              <Form.Item name="photoFile" label="现场照片（可选）" valuePropName="file" getValueFromEvent={(e) => e?.fileList?.[0]?.originFileObj} style={{ marginBottom: 0 }}>
                <Upload beforeUpload={() => false} maxCount={1} accept="image/*">
                  <Button icon={<UploadOutlined />} block>选择照片</Button>
                </Upload>
              </Form.Item>
              <div style={{ display: "flex", gap: 10, marginTop: 14, borderTop: `1px solid ${token.colorBorder}`, paddingTop: 12 }}>
                <Button style={{ width: 120 }} onClick={() => setOpen(false)}>取消</Button>
                <Button type="primary" loading={saving} style={{ flex: 1 }} onClick={() => void save()}>提交上报</Button>
              </div>
            </Form>
          )}
        </div>
      </div>

      {/* 定位到故障点（内嵌地图） */}
      <Modal open={!!locFault} onCancel={() => setLocFault(null)} footer={null} title={locFault ? `故障 #${locFault.id} 位置` : ""} width={720} destroyOnHidden>
        {locFault && (
          <>
            <p style={{ marginBottom: 8, color: token.colorTextSecondary, fontSize: 12.5 }}>
              {locFault.fault_type || "未分类"} · 状态：{STATUS[locFault.status]?.label} · {locFault.lat.toFixed(6)}, {locFault.lng.toFixed(6)}
            </p>
            <div style={{ height: 420, border: `1px solid ${token.colorBorder}`, borderRadius: 12, overflow: "hidden" }}>
              <MapView sources={sources} center={[locFault.lat, locFault.lng]} zoom={16} overlays={{ cables: [], faults: [locFault], markersByCable: {} }} height="420px" />
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
        <p style={{ color: token.colorTextSecondary, fontSize: 12.5 }}>
          已关闭的故障删除需管理员审核：提交申请并通知管理者，审核通过后才会从列表与地图移除（数据保留可追溯，申请进度可在「系统管理 → 删除审核」查看）。
        </p>
        <Input.TextArea rows={3} maxLength={500} placeholder="请填写删除原因（必填）" value={delReason} onChange={(e) => setDelReason(e.target.value)} />
      </Modal>

      {/* 详情抽屉 */}
      <Drawer open={!!detail} onClose={() => setDetail(null)} width={520} title={detail ? `故障 #${detail.id}` : ""}>
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              类型：{detail.fault_type || "—"}　严重度：
              <Tag style={{ borderRadius: 999, background: SEVERITY[detail.severity]?.bg, color: SEVERITY[detail.severity]?.fg, borderColor: "transparent" }}>{SEVERITY[detail.severity]?.label}</Tag>
              　状态：
              <Tag style={{ borderRadius: 999, background: STATUS[detail.status]?.bg, color: STATUS[detail.status]?.fg, borderColor: "transparent" }}>{STATUS[detail.status]?.label}</Tag>
            </div>
            <div style={{ color: token.colorTextSecondary, fontSize: 12.5 }}>位置：{detail.lat.toFixed(6)}, {detail.lng.toFixed(6)}（累计 {detail.cumulative_distance.toFixed(1)} m）</div>
            <div style={{ fontSize: 13 }}>描述：{detail.description || "—"}</div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>照片（{photos.length}）</div>
            <Space wrap>
              {photos.map((p) => (
                <Image key={p.id} src={p.url} width={120} height={90} style={{ objectFit: "cover", borderRadius: 10 }} alt={p.category} />
              ))}
            </Space>
            <Upload showUploadList={false} beforeUpload={uploadPhoto} accept="image/*">
              <Button icon={<UploadOutlined />}>补充照片（维修后）</Button>
            </Upload>
          </div>
        )}
      </Drawer>
    </div>
  );
}
