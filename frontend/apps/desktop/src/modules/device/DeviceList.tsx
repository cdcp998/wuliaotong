/** device 模块：设备台账（/device/list，device:manage）——CRUD + 生命周期状态流转。
 *  v2 界面：统计卡 + 状态胶囊 Tabs + 玻璃表格（与设计稿一致）。 */
import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Image, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, theme, Upload } from "antd";
import { EnvironmentOutlined, PlusOutlined, ReloadOutlined, LaptopOutlined, CheckCircleOutlined, ToolOutlined, WarningOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { fileApi } from "@wlt/shared";

import { deviceApi, type DeviceItem } from "./api";

const ST: Record<number, { label: string; fg: string; bg: string }> = {
  1: { label: "在用", fg: "#15803D", bg: "#E8F9EF" },
  2: { label: "维修中", fg: "#B45309", bg: "#FEF4E2" },
  3: { label: "闲置", fg: "#475569", bg: "#EFF3FC" },
  4: { label: "报废", fg: "#B91C1C", bg: "#FDEBEC" },
};

export function DeviceListPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [rows, setRows] = useState<DeviceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingFiles, setExistingFiles] = useState<{ id: number; file_id: number }[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [locating, setLocating] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await deviceApi.list({ keyword, status: filterStatus, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, filterStatus, page, pageSize, message]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    Promise.all([["", "全部"], ["1", "在用"], ["2", "维修中"], ["3", "闲置"], ["4", "报废"]].map(async ([st]) => {
      try {
        const r = await deviceApi.list({ status: st, page: 1, page_size: 1 });
        return [st, r.total] as const;
      } catch { return [st, 0] as const; }
    })).then((cs) => setCounts(Object.fromEntries(cs)));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setExistingFiles([]);
    setNewFiles([]);
    form.resetFields();
    form.setFieldsValue({ status: 1 });
    setOpen(true);
  };

  const openEdit = async (d: DeviceItem) => {
    setEditing(d);
    setExistingFiles([]);
    setNewFiles([]);
    form.setFieldsValue({
      code: d.code, name: d.name, model: d.model, category: d.category, location: d.location,
      lat: d.lat, lng: d.lng, status: d.status, remark: d.remark,
    });
    try {
      setExistingFiles(await deviceApi.listFiles(d.id));
    } catch {
      setExistingFiles([]);
    }
    setOpen(true);
  };

  const locate = () => {
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        form.setFieldsValue({ lat: Number(pos.coords.latitude.toFixed(7)), lng: Number(pos.coords.longitude.toFixed(7)) });
        message.success(`定位获取成功（精度 ±${Math.round(pos.coords.accuracy ?? 0)}m，WGS84）`);
        setLocating(false);
      },
      () => { message.warning("无法获取定位，请手动输入坐标"); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const removeExisting = async (linkId: number) => {
    if (!editing) return;
    try {
      await deviceApi.deleteFile(editing.id, linkId);
      setExistingFiles((fs) => fs.filter((f) => f.id !== linkId));
      message.success("已移除图片");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "移除失败");
    }
  };

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      let deviceId: number;
      if (editing) {
        await deviceApi.update(editing.id, { name: v.name, model: v.model ?? "", category: v.category ?? "", location: v.location ?? "", lat: v.lat ?? null, lng: v.lng ?? null, remark: v.remark ?? "" });
        deviceId = editing.id;
      } else {
        const created = await deviceApi.create({ code: v.code, name: v.name, model: v.model ?? "", category: v.category ?? "", location: v.location ?? "", lat: v.lat ?? null, lng: v.lng ?? null, status: v.status });
        deviceId = created.id;
      }
      for (const f of newFiles) {
        try {
          const up = await fileApi.upload(f, "device");
          await deviceApi.addFile(deviceId, up.file_id);
        } catch {
          message.warning("部分图片上传失败");
          break;
        }
      }
      message.success("已保存");
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (d: DeviceItem, status: number) => {
    try {
      await deviceApi.status(d.id, status);
      message.success("状态已更新");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "状态更新失败（维修中禁止报废等规则）");
    }
  };

  const columns: ColumnsType<DeviceItem> = [
    { title: "设备", width: 300, render: (_, d) => (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {d.cover_file_id ? <Image src={`/api/v1/files/${d.cover_file_id}`} width={44} height={44} style={{ objectFit: "cover", borderRadius: 10, flexShrink: 0 }} /> : (
          <span style={{ width: 44, height: 44, borderRadius: 10, background: "#EAEFFF", color: "#3B5BDB", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><LaptopOutlined /></span>
        )}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{d.name}</div>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{d.code}</div>
        </div>
      </div>
    ) },
    { title: "型号", dataIndex: "model", width: 130, render: (v: string) => v || <span style={{ color: token.colorTextTertiary }}>—</span> },
    { title: "类别", dataIndex: "category", width: 110, render: (v: string) => v || <span style={{ color: token.colorTextTertiary }}>—</span> },
    { title: "物理位置", width: 180, ellipsis: true, render: (_, d) => d.location || (d.lat != null ? `${d.lat.toFixed(5)}, ${d.lng?.toFixed(5)}` : <span style={{ color: token.colorTextTertiary }}>—</span>) },
    { title: "状态", width: 100, render: (_, d) => { const s = ST[d.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? d.status}</Tag>; } },
    { title: "更新时间", dataIndex: "updated_at", width: 150, render: (v: string | null) => (v ? <span style={{ fontSize: 12 }}>{new Date(v).toLocaleString()}</span> : <span style={{ color: token.colorTextTertiary }}>—</span>) },
    {
      title: "操作", width: 240,
      render: (_, d) => (
        <Space size={4}>
          <Button size="small" onClick={() => openEdit(d)}>编辑</Button>
          {d.status !== 4 && d.status !== 2 && <Button size="small" onClick={() => changeStatus(d, 2)}>送修</Button>}
          {d.status === 2 && <Button size="small" onClick={() => changeStatus(d, 1)}>在用</Button>}
          {d.status === 1 && <Button size="small" onClick={() => changeStatus(d, 3)}>闲置</Button>}
          {d.status === 3 && <Button size="small" onClick={() => changeStatus(d, 1)}>启用</Button>}
          {d.status !== 4 && d.status !== 2 && (
            <Popconfirm title="报废该设备？" onConfirm={() => changeStatus(d, 4)}>
              <Button size="small" danger>报废</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>设备台账</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>全生命周期管理：在用 ⇄ 维修中 ⇄ 闲置 → 报废；维保到期自动提醒</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增设备</Button>
        </Space>
      </div>

      {/* 统计卡 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
        {[
          { icon: <LaptopOutlined />, label: "设备总数", value: counts[""] ?? "…", color: "#1E2433", bg: "#F6F8FE" },
          { icon: <CheckCircleOutlined />, label: "在用", value: counts["1"] ?? "…", color: "#15803D", bg: "#E8F9EF" },
          { icon: <ToolOutlined />, label: "维修中", value: counts["2"] ?? "…", color: "#B45309", bg: "#FEF4E2" },
          { icon: <WarningOutlined />, label: "即将报废/到期", value: "—", color: "#B45309", bg: "#FEF4E2" },
        ].map((c) => (
          <div key={c.label} className="wlt-glass-sm" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 12, background: c.bg, color: c.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{c.icon}</span>
            <div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 状态 Tabs + 筛选 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {[["", "全部"], ["1", "在用"], ["2", "维修中"], ["3", "闲置"], ["4", "报废"]].map(([st, label]) => {
          const active = filterStatus === st;
          return (
            <button key={st} type="button" onClick={() => { setFilterStatus(st); setPage(1); }}
              style={{ cursor: "pointer", border: `1px solid ${active ? "#5B7FFF" : token.colorBorder}`, background: active ? "#5B7FFF" : "#fff", color: active ? "#fff" : token.colorTextSecondary, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: active ? 600 : 500, display: "inline-flex", gap: 6, alignItems: "center", fontFamily: "inherit", transition: "all .2s ease" }}>
              {label} <span style={{ opacity: 0.75, fontWeight: 600 }}>{counts[st] ?? "…"}</span>
            </button>
          );
        })}
        <Input.Search placeholder="编码 / 名称 / 型号" allowClear style={{ width: 240, marginLeft: "auto" }} onSearch={(v) => { setKeyword(v); setPage(1); }} />
      </div>

      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<DeviceItem>
          rowKey="id" loading={loading} dataSource={rows} locale={{ emptyText: "暂无设备" }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 台`, onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); } }}
          columns={columns}
        />
      </div>

      {/* 新增/编辑（保留原逻辑） */}
      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} title={editing ? "编辑设备" : "新增设备"} width={620} destroyOnHidden forceRender>
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item name="code" label="设备编码" rules={[{ required: true, message: "请输入编码" }]}>
              <Input maxLength={50} />
            </Form.Item>
          )}
          <Form.Item name="name" label="设备名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Space>
            <Form.Item name="model" label="型号/规格"><Input style={{ width: 220 }} maxLength={100} /></Form.Item>
            <Form.Item name="category" label="类别"><Input style={{ width: 180 }} maxLength={50} /></Form.Item>
            {!editing && (
              <Form.Item name="status" label="状态">
                <Select style={{ width: 120 }} options={Object.entries(ST).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
              </Form.Item>
            )}
          </Space>
          <Form.Item name="location" label="物理位置"><Input maxLength={200} /></Form.Item>
          <Space>
            <Form.Item name="lat" label="纬度（WGS84）"><InputNumber style={{ width: 180 }} min={-90} max={90} step={0.000001} /></Form.Item>
            <Form.Item name="lng" label="经度（WGS84）"><InputNumber style={{ width: 180 }} min={-180} max={180} step={0.000001} /></Form.Item>
            <Button icon={<EnvironmentOutlined />} loading={locating} onClick={locate}>定位获取</Button>
          </Space>
          <Form.Item label={<span>设备图片（可选，{existingFiles.length + newFiles.length}/6）</span>}>
            <Space wrap>
              {existingFiles.map((f) => (
                <span key={f.id} style={{ position: "relative", display: "inline-block" }}>
                  <Image src={`/api/v1/files/${f.file_id}`} width={72} height={72} style={{ objectFit: "cover", borderRadius: 10 }} />
                  <span onClick={() => void removeExisting(f.id)} style={{ position: "absolute", top: -6, right: -6, background: "#EF4444", color: "#fff", borderRadius: 10, width: 18, height: 18, fontSize: 11, lineHeight: "18px", textAlign: "center", cursor: "pointer" }}>×</span>
                </span>
              ))}
              {newFiles.map((f, i) => (
                <span key={`n${i}`} style={{ position: "relative", display: "inline-block" }}>
                  <Image src={URL.createObjectURL(f)} width={72} height={72} style={{ objectFit: "cover", borderRadius: 10 }} />
                  <span onClick={() => setNewFiles((fs) => fs.filter((_, x) => x !== i))} style={{ position: "absolute", top: -6, right: -6, background: "#EF4444", color: "#fff", borderRadius: 10, width: 18, height: 18, fontSize: 11, lineHeight: "18px", textAlign: "center", cursor: "pointer" }}>×</span>
                </span>
              ))}
              {existingFiles.length + newFiles.length < 6 && (
                <Upload accept="image/*" showUploadList={false} beforeUpload={(f) => { setNewFiles((fs) => [...fs, f]); return false; }}>
                  <Button size="small">+ 选择图片</Button>
                </Upload>
              )}
            </Space>
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
