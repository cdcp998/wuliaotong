/** device 模块：设备台账（/device/list，device:manage）——CRUD + 生命周期状态流转。 */
import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload, Image } from "antd";
import { EnvironmentOutlined, PlusOutlined } from "@ant-design/icons";

import { fileApi } from "@wlt/shared";

import { DEVICE_STATUS, deviceApi, type DeviceItem } from "./api";

export function DeviceListPage() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<DeviceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
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
      // 上传新选图片（可选）
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

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>设备台账</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增设备</Button>
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <Input.Search placeholder="编码/名称/型号" allowClear style={{ width: 240 }} onSearch={(v) => { setKeyword(v); setPage(1); }} />
        <Select placeholder="状态" allowClear style={{ width: 140 }} value={filterStatus || undefined} onChange={(v) => { setFilterStatus(v ?? ""); setPage(1); }}
          options={Object.entries(DEVICE_STATUS).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
      </Space>
      <Table<DeviceItem>
        rowKey="id" loading={loading} dataSource={rows}
        pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        columns={[
          { title: "图片", dataIndex: "cover_file_id", width: 70, render: (v: number | null | undefined) => v ? <Image src={`/api/v1/files/${v}`} width={44} height={44} style={{ objectFit: "cover", borderRadius: 6 }} /> : <span style={{ color: "#ccc" }}>—</span> },
          { title: "编码", dataIndex: "code", width: 130 },
          { title: "名称", dataIndex: "name" },
          { title: "型号", dataIndex: "model", width: 130, render: (v: string) => v || "—" },
          { title: "类别", dataIndex: "category", width: 110, render: (v: string) => v || "—" },
          { title: "位置", dataIndex: "location", width: 150, ellipsis: true, render: (v: string, d) => v || (d.lat ? `${d.lat?.toFixed(5)}, ${d.lng?.toFixed(5)}` : "—") },
          { title: "状态", dataIndex: "status", width: 90, render: (v: number) => <Tag color={DEVICE_STATUS[v]?.color}>{DEVICE_STATUS[v]?.label ?? v}</Tag> },
          {
            title: "操作", width: 250,
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
        ]}
      />

      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} title={editing ? "编辑设备" : "新增设备"} width={620} destroyOnHidden>
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
                <Select style={{ width: 120 }} options={Object.entries(DEVICE_STATUS).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
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
                  <Image src={`/api/v1/files/${f.file_id}`} width={72} height={72} style={{ objectFit: "cover", borderRadius: 6 }} />
                  <span onClick={() => void removeExisting(f.id)}
                    style={{ position: "absolute", top: -6, right: -6, background: "#ff4d4f", color: "#fff", borderRadius: 10, width: 18, height: 18, fontSize: 11, lineHeight: "18px", textAlign: "center", cursor: "pointer" }}>×</span>
                </span>
              ))}
              {newFiles.map((f, i) => (
                <span key={`n${i}`} style={{ position: "relative", display: "inline-block" }}>
                  <Image src={URL.createObjectURL(f)} width={72} height={72} style={{ objectFit: "cover", borderRadius: 6 }} />
                  <span onClick={() => setNewFiles((fs) => fs.filter((_, x) => x !== i))}
                    style={{ position: "absolute", top: -6, right: -6, background: "#ff4d4f", color: "#fff", borderRadius: 10, width: 18, height: 18, fontSize: 11, lineHeight: "18px", textAlign: "center", cursor: "pointer" }}>×</span>
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
