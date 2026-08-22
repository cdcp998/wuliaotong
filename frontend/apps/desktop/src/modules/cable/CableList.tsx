/** cable 模块：线缆管理（/cable/list，cable:manage）——CRUD + 路径节点绘制（地图选点）+ 状态流转。 */
import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";

import { cableApi, type CableItem, type MapSourceInfo, type MarkerItem } from "./api";
import { MapView } from "./MapView";

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  wire: { label: "电线", color: "blue" },
  fiber: { label: "光缆", color: "green" },
  network: { label: "网线", color: "purple" },
};
const STATUS_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "在用", color: "success" },
  0: { label: "停用", color: "default" },
  2: { label: "归档", color: "warning" },
};

interface PointRow {
  lat: number;
  lng: number;
  key: number;
}

export function CableListPage() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<CableItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [filterType, setFilterType] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CableItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [points, setPoints] = useState<PointRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [sources, setSources] = useState<Record<string, MapSourceInfo>>({});
  const [markers, setMarkers] = useState<MarkerItem[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await cableApi.listCables({ keyword, type: filterType, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载线缆列表失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, filterType, page, pageSize, message]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    cableApi.mapSources().then((s) => setSources(s.map_sources)).catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setPoints([]);
    form.resetFields();
    form.setFieldsValue({ type: "wire", status: 1 });
    setOpen(true);
  };

  const openEdit = async (c: CableItem) => {
    try {
      const detail = await cableApi.getCable(c.id);
      setEditing(detail);
      form.setFieldsValue({ code: detail.code, name: detail.name, type: detail.type, status: detail.status, description: detail.description });
      setPoints((detail.points ?? []).map((p, i) => ({ lat: p.lat, lng: p.lng, key: i })));
      setMarkers(await cableApi.listMarkers(c.id));
      setOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载线缆详情失败");
    }
  };

  const addPoint = (lat: number, lng: number) => {
    setPoints((ps) => [...ps, { lat, lng, key: Date.now() + Math.random() }]);
    setPicking(false);
  };

  const save = async () => {
    const values = await form.validateFields();
    if (points.length < 2) {
      message.warning("至少需要 2 个路径节点");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await cableApi.updatePoints(editing.id, points.map((p) => ({ lat: p.lat, lng: p.lng })));
        await cableApi.updateCable(editing.id, { name: values.name, type: values.type, status: values.status, description: values.description ?? "" });
      } else {
        await cableApi.createCable({
          code: values.code,
          name: values.name,
          type: values.type,
          status: values.status,
          description: values.description ?? "",
          points: points.map((p) => ({ lat: p.lat, lng: p.lng })),
        });
      }
      message.success(editing ? "已保存" : "已创建");
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (c: CableItem, status: number) => {
    try {
      await cableApi.updateCableStatus(c.id, status);
      message.success("状态已更新");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>线缆管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增线缆</Button>
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <Input.Search placeholder="编码/名称" allowClear style={{ width: 240 }} onSearch={(v) => { setKeyword(v); setPage(1); }} />
        <Select
          placeholder="类型"
          allowClear
          style={{ width: 140 }}
          value={filterType || undefined}
          onChange={(v) => { setFilterType(v ?? ""); setPage(1); }}
          options={Object.entries(TYPE_LABEL).map(([k, v]) => ({ value: k, label: v.label }))}
        />
      </Space>
      <Table<CableItem>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        columns={[
          { title: "编码", dataIndex: "code", width: 120 },
          { title: "名称", dataIndex: "name" },
          { title: "类型", dataIndex: "type", width: 90, render: (v: string) => <Tag color={TYPE_LABEL[v]?.color}>{TYPE_LABEL[v]?.label ?? v}</Tag> },
          { title: "长度(m)", dataIndex: "total_length", width: 110, render: (v: number) => v.toFixed(2) },
          { title: "状态", dataIndex: "status", width: 90, render: (v: number) => <Tag color={STATUS_LABEL[v]?.color}>{STATUS_LABEL[v]?.label ?? v}</Tag> },
          { title: "描述", dataIndex: "description", ellipsis: true },
          {
            title: "操作",
            width: 260,
            render: (_, c) => (
              <Space size={4}>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(c)}>编辑</Button>
                {c.status === 1 && (
                  <Popconfirm title="停用该线缆？" onConfirm={() => changeStatus(c, 0)}>
                    <Button size="small">停用</Button>
                  </Popconfirm>
                )}
                {c.status === 0 && (
                  <Button size="small" onClick={() => changeStatus(c, 1)}>启用</Button>
                )}
                {c.status !== 2 && (
                  <Popconfirm title="归档该线缆？" onConfirm={() => changeStatus(c, 2)}>
                    <Button size="small">归档</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        confirmLoading={saving}
        title={editing ? `编辑线缆：${editing.name}` : "新增线缆"}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item name="code" label="线缆编码" rules={[{ required: true, message: "请输入编码" }]}>
              <Input maxLength={50} placeholder="如 DL-001" />
            </Form.Item>
          )}
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Space>
            <Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select style={{ width: 140 }} options={Object.entries(TYPE_LABEL).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Form.Item>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}>
              <Select style={{ width: 140 }} options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
        <Typography.Text strong>路径节点（≥2；点击地图加点）</Typography.Text>
        <div style={{ height: 300, margin: "8px 0", border: "1px solid #e5e6eb", borderRadius: 6, overflow: "hidden" }}>
          <MapView
            sources={sources}
            overlays={{ cables: editing ? [editing] : [], faults: [], markersByCable: {} }}
            previewPath={points.map((p) => [p.lat, p.lng])}
            onPick={addPoint}
            picking={picking ? "点击地图添加路径节点（选点自动连线预览）" : undefined}
            height="300px"
          />
        </div>
        <Space direction="vertical" style={{ width: "100%" }} size={4}>
          {points.map((p, i) => (
            <Space key={p.key} style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Text>
                #{i + 1}　{p.lat.toFixed(6)}, {p.lng.toFixed(6)}
              </Typography.Text>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setPoints((ps) => ps.filter((x) => x.key !== p.key))} />
            </Space>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => setPicking(true)}>地图选点</Button>
        </Space>
        {markers.length > 0 && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
            已有关联标记点：{markers.map((m) => m.label || m.marker_type).join("、")}
          </Typography.Paragraph>
        )}
      </Modal>
    </div>
  );
}
