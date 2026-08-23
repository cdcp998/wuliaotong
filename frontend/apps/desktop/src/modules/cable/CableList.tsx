/** cable 模块：线缆管理（/cable/list，cable:manage）—— CRUD + 路径节点（地图选点）+ 状态流转。
 *  v2 界面：左侧统计/筛选/表格 + 右侧「新增线缆」玻璃面板（与设计稿一致）。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Form, Input, Popconfirm, Radio, Select, Space, Table, Tag, theme } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, EnvironmentOutlined, CheckOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { cableApi, type CableItem, type MarkerItem } from "./api";
import { mapApi, type MapSourceInfo } from "../map/api";
import { MapView } from "../map/MapView";

const TYPE_LABEL: Record<string, { label: string; fg: string; bg: string }> = {
  wire: { label: "电力电缆", fg: "#3B5BDB", bg: "#EAEFFF" },
  fiber: { label: "光缆", fg: "#7C3AED", bg: "#F3E8FF" },
  network: { label: "网络线", fg: "#0E7490", bg: "#E0F2FE" },
};
const STATUS_LABEL: Record<number, { label: string; fg: string; bg: string }> = {
  1: { label: "在用", fg: "#15803D", bg: "#E8F9EF" },
  0: { label: "停用", fg: "#8A93A8", bg: "#EFF3FC" },
  2: { label: "归档", fg: "#B45309", bg: "#FEF4E2" },
};

interface PointRow { lat: number; lng: number; key: number }

export function CableListPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [rows, setRows] = useState<CableItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
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
      const r = await cableApi.listCables({ keyword, type: filterType, status: filterStatus, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载线缆列表失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, filterType, filterStatus, page, pageSize, message]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    mapApi.mapSources().then((s) => setSources(s.map_sources)).catch(() => undefined);
    // 状态角标：各状态数量（page_size=1 取 total）
    Promise.all([["", "全部"], ["1", "在用"], ["0", "停用"], ["2", "归档"]].map(async ([st]) => {
      try {
        const r = await cableApi.listCables({ status: st, page: 1, page_size: 1 });
        return [st, r.total] as const;
      } catch { return [st, 0] as const; }
    })).then((cs) => setCounts(Object.fromEntries(cs)));
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

  const columns = useMemo<ColumnsType<CableItem>>(
    () => [
      { title: "线缆", width: 300, render: (_, c) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</div>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{c.code}</div>
        </div>
      ) },
      { title: "类型", width: 110, render: (_, c) => { const t = TYPE_LABEL[c.type]; return <Tag style={{ borderRadius: 999, background: t?.bg, color: t?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{t?.label ?? c.type}</Tag>; } },
      { title: "总长度", dataIndex: "total_length", width: 110, align: "right", render: (v: number) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{Number(v).toFixed(0)} m</span> },
      { title: "节点", width: 80, align: "right", render: (_, c) => (c.points?.length ?? 0) },
      { title: "状态", width: 100, render: (_, c) => { const s = STATUS_LABEL[c.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? c.status}</Tag>; } },
      { title: "描述", dataIndex: "description", ellipsis: true, render: (v: string) => v || <span style={{ color: token.colorTextTertiary }}>—</span> },
      {
        title: "操作", width: 230,
        render: (_, c) => (
          <Space size={4}>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(c)}>编辑</Button>
            {c.status === 1 && <Popconfirm title="停用该线缆？" onConfirm={() => changeStatus(c, 0)}><Button size="small">停用</Button></Popconfirm>}
            {c.status === 0 && <Button size="small" onClick={() => changeStatus(c, 1)}>启用</Button>}
            {c.status !== 2 && <Popconfirm title="归档该线缆？" onConfirm={() => changeStatus(c, 2)}><Button size="small">归档</Button></Popconfirm>}
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token]
  );

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>线缆管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>线缆台账 · 路径节点 · 长度自动计算；新增线缆支持地图选点连线</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增线缆</Button>
        </Space>
      </div>

      {/* 状态 Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {[["", "全部"], ["1", "在用"], ["0", "停用"], ["2", "归档"]].map(([st, label]) => {
          const active = filterStatus === st;
          return (
            <button key={st} type="button" onClick={() => { setFilterStatus(st); setPage(1); }}
              style={{ cursor: "pointer", border: `1px solid ${active ? "#5B7FFF" : token.colorBorder}`, background: active ? "#5B7FFF" : "#fff", color: active ? "#fff" : token.colorTextSecondary, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: active ? 600 : 500, display: "inline-flex", gap: 6, alignItems: "center", fontFamily: "inherit", transition: "all .2s ease" }}>
              {label} <span style={{ opacity: 0.75, fontWeight: 600 }}>{counts[st] ?? "…"}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* 左：表格 */}
        <div className="wlt-glass" style={{ flex: 1, minWidth: 320, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 10px", flexWrap: "wrap" }}>
            <Input.Search placeholder="搜索编码 / 名称" allowClear style={{ width: 240 }} onSearch={(v) => { setKeyword(v); setPage(1); }} />
            <Select placeholder="全部类型" allowClear style={{ width: 150 }} value={filterType || undefined} onChange={(v) => { setFilterType(v ?? ""); setPage(1); }}
              options={Object.entries(TYPE_LABEL).map(([k, v]) => ({ value: k, label: v.label }))} />
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>共 {total} 条</span>
          </div>
          <Table<CableItem>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            locale={{ emptyText: "暂无线缆" }}
            pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); } }}
            columns={columns}
          />
        </div>

        {/* 右：新增 / 编辑面板 */}
        <div className="wlt-glass" style={{ width: 396, padding: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{editing ? `编辑线缆：${editing.name}` : "新增线缆"}</span>
            {editing ? <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }} color="blue">编辑中</Tag> : <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }} color="blue">新建</Tag>}
          </div>
          {!open && !editing && (
            <div style={{ textAlign: "center", padding: "40px 12px", color: token.colorTextTertiary, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <EnvironmentOutlined style={{ fontSize: 36, color: "#CBD6EC" }} />
              <div style={{ fontWeight: 600 }}>新增 / 编辑线缆</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>点击右上角「新增线缆」打开表单：填写基本信息 → 地图选点生成路径（≥2 点）→ 保存自动重算长度</div>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增线缆</Button>
            </div>
          )}
          {open && (
            <Form form={form} layout="vertical" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {!editing && (
                <Form.Item name="code" label="线缆编码" rules={[{ required: true, message: "请输入编码" }]} style={{ marginBottom: 12 }}>
                  <Input maxLength={50} placeholder="如 DL-001" />
                </Form.Item>
              )}
              <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]} style={{ marginBottom: 12 }}>
                <Input maxLength={100} placeholder="如：环网 10kV 电缆 · 东区段" />
              </Form.Item>
              <Form.Item name="type" label="类型" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <Radio.Group optionType="button" buttonStyle="solid" style={{ display: "flex" }}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <Radio.Button key={k} value={k} style={{ flex: 1, textAlign: "center", borderRadius: 10 }}>{v.label}</Radio.Button>)}
                </Radio.Group>
              </Form.Item>
              <Form.Item name="status" label="状态" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <Select options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: Number(k), label: v.label }))} />
              </Form.Item>
              <Form.Item name="description" label="描述" style={{ marginBottom: 12 }}>
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary, marginBottom: 6 }}>路径节点（≥2 · 点击地图加点）</div>
              <div style={{ height: 220, borderRadius: 12, overflow: "hidden", border: `1px solid ${token.colorBorder}`, marginBottom: 8 }}>
                <MapView sources={sources} overlays={{ cables: editing ? [editing] : [], faults: [], markersByCable: {} }}
                  previewPath={points.map((p) => [p.lat, p.lng])} onPick={addPoint}
                  picking={picking ? "点击地图添加路径节点（选点自动连线预览）" : undefined} height="220px" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 150, overflowY: "auto", marginBottom: 8 }}>
                {points.map((p, i) => (
                  <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F6F8FE", borderRadius: 8, padding: "5px 10px" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 11, background: "#EAEFFF", color: "#3B5BDB", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 12, color: token.colorTextSecondary, flex: 1, fontVariantNumeric: "tabular-nums" }}>{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</span>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setPoints((ps) => ps.filter((x) => x.key !== p.key))} />
                  </div>
                ))}
                {!points.length && <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>尚未添加节点</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button icon={<PlusOutlined />} onClick={() => setPicking(true)} style={{ flex: 1 }}>地图选点</Button>
              </div>
              {markers.length > 0 && <span style={{ fontSize: 11, color: token.colorTextTertiary }}>已有关联标记点：{markers.map((m) => m.label || m.marker_type).join("、")}</span>}
              <div style={{ display: "flex", gap: 10, marginTop: 12, borderTop: `1px solid ${token.colorBorder}`, paddingTop: 12 }}>
                <Button style={{ width: 120 }} onClick={() => setOpen(false)}>取消</Button>
                <Button type="primary" icon={<CheckOutlined />} loading={saving} style={{ flex: 1 }} onClick={() => void save()}>保存线缆</Button>
              </div>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}
