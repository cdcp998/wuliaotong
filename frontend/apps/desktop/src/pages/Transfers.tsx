import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";

import { baseApi, transferApi, type TransferBill, type TransferDetail } from "@wlt/shared";

import { BillDetailDrawer } from "../components/BillDetailDrawer";

const STATUS_META: Record<string, { label: string; fg: string; bg: string }> = {
  "0": { label: "待审核", fg: "#B45309", bg: "#FEF4E2" },
  "1": { label: "已完成", fg: "#15803D", bg: "#E8F9EF" },
  "-1": { label: "已作废", fg: "#475569", bg: "#EFF3FC" },
  "-2": { label: "已驳回", fg: "#B91C1C", bg: "#FDEBEC" },
};

interface Row {
  product_id: number | undefined;
  from_location_id: number | undefined;
  to_location_id: number | undefined;
  qty: number;
}

/** 库存调拨（设计页 22，电脑端，stk:transfer）：仓库/库位间移动库存——同仓即时生效；跨仓需审核（统一库存事务防超调）。 */
export function TransfersPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<number | undefined>();
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<TransferBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<TransferDetail | null>(null);

  async function openDetail(r: TransferBill) {
    try {
      setDetail(await transferApi.detail(r.id));
      setDetailOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: number; name: string; code: string }[]>([]);
  const [locs, setLocs] = useState<Record<number, { id: number; display: string }[]>>({});
  const [form, setForm] = useState({ from_warehouse_id: 0, to_warehouse_id: 0, rows: [] as Row[] });

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
      const data = await transferApi.list(status, page, pageSize, keyword);
      setList(data.list);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [status, keyword, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.warehouses().then((ws) => setWarehouses(ws.filter((w) => w.status === 1).map((w) => ({ id: w.id, name: w.name }))));
    baseApi.products("", 1).then((p) => setProducts(p.list));
  }, []);

  async function loadLocs(whId: number) {
    if (locs[whId]) return;
    const data = await baseApi.locations(whId);
    setLocs((m) => ({ ...m, [whId]: data.map((l) => ({ id: l.id, display: l.display ?? l.code })) }));
  }

  function setRow(i: number, patch: Partial<Row>) {
    setForm((f) => ({ ...f, rows: f.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }

  async function create() {
    if (!form.from_warehouse_id || !form.to_warehouse_id) return message.warning("请选择调出/调入仓库");
    if (form.from_warehouse_id === form.to_warehouse_id) return message.warning("调出与调入仓库不能相同");
    const items = form.rows
      .filter((r) => r.product_id && r.from_location_id && r.to_location_id && r.qty > 0)
      .map((r) => ({ product_id: r.product_id!, qty: String(r.qty), from_location_id: r.from_location_id!, to_location_id: r.to_location_id! }));
    if (!items.length) return message.warning("请至少添加一条有效明细");
    try {
      const data = await transferApi.create(form.from_warehouse_id, form.to_warehouse_id, items);
      message.success(`调拨单 ${data.bill_no} 已创建`);
      setOpen(false);
      setForm({ from_warehouse_id: 0, to_warehouse_id: 0, rows: [] });
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  }

  const linkBtn = (color: string) => ({ type: "link" as const, size: "small" as const, style: { padding: 0, fontSize: 12.5, color } });

  const columns: ColumnsType<TransferBill> = [
    { title: "单号", dataIndex: "bill_no", width: 170, render: (v: string) => <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3B5BDB" }}>{v}</span> },
    {
      title: "材料", key: "mat", width: 260,
      render: (_, r) => {
        const items = r.items ?? [];
        const first = items[0];
        if (!first) return <span style={{ color: "#6A748A", fontSize: 12 }}>—</span>;
        return (
          <span style={{ fontSize: 12.5, color: "#1E2433" }}>
            {first.product_name}
            {items.length > 1 && <span style={{ color: "#6A748A", fontSize: 11 }}> 等 {items.length} 种</span>}
          </span>
        );
      },
    },
    {
      title: "数量", key: "qty", width: 90,
      render: (_, r) => <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{(r.items ?? []).reduce((s, it) => s + Number(it.qty || 0), 0).toLocaleString("zh-CN")}</span>,
    },
    { title: "调出", dataIndex: "from_warehouse_name", width: 160, render: (v: string) => <span style={{ fontSize: 12, color: "#5B6478" }}>{v}</span> },
    { title: "调入", dataIndex: "to_warehouse_name", width: 160, render: (v: string) => <span style={{ fontSize: 12, color: "#5B6478" }}>{v}</span> },
    {
      title: "状态", dataIndex: "status", width: 120,
      render: (s: number) => { const m = STATUS_META[String(s)] ?? { label: String(s), fg: "#5B6478", bg: "#EFF3FC" }; return <Tag style={{ borderRadius: 999, background: m.bg, color: m.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{m.label}</Tag>; },
    },
    { title: "审计人", dataIndex: "audit_name", width: 110, render: (v: string) => <span style={{ fontSize: 12, color: "#5B6478" }}>{v || "—"}</span> },
    { title: "日期", dataIndex: "created_at", width: 130, render: (v: string) => <span style={{ fontSize: 12, color: "#6A748A", fontVariantNumeric: "tabular-nums" }}>{v ? v.slice(5, 16) : "—"}</span> },
    {
      title: "操作", key: "op", width: 150,
      render: (_, r) => (
        <Space size={10} style={{ padding: "0 10px" }}>
          <Button {...linkBtn("#5B6478")} onClick={() => void openDetail(r)}>详情</Button>
          {r.status === 0 && (
            <>
              <Popconfirm title="确认审核过账？" onConfirm={async () => { try { await transferApi.audit(r.id); message.success("已审核"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
                <Button {...linkBtn("#5B7FFF")}>通过</Button>
              </Popconfirm>
              <Popconfirm title="确认驳回该调拨单？" onConfirm={async () => { try { await transferApi.reject(r.id); message.success("已驳回"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
                <Button {...linkBtn("#DC2626")}>驳回</Button>
              </Popconfirm>
            </>
          )}
          {r.status !== -1 && (
            <Popconfirm title="确认作废？" onConfirm={async () => { try { await transferApi.void(r.id); message.success("已作废"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
              <Button {...linkBtn("#DC2626")}>作废</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 22） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>库存调拨</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#5B6478" }}>
            仓库/库位间移动库存：同仓即时生效；跨仓需审核（统一库存事务防超调）
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建调拨</Button>
      </div>

      {/* 筛选条（设计页 22：搜索 + 状态 + 统计） */}
      <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#6A748A" }} />}
          placeholder="单号 / 材料 / 仓库"
          allowClear
          style={{ width: 300, background: "#F6F8FE" }}
          onChange={(e) => { if (!e.target.value) { setKeyword(""); setPage(1); } }}
          onPressEnter={(e) => { setKeyword((e.target as HTMLInputElement).value.trim()); setPage(1); }}
        />
        <Select
          placeholder="全部状态"
          allowClear
          style={{ width: 170 }}
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={Object.entries(STATUS_META).map(([v, m]) => ({ value: Number(v), label: m.label }))}
        />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6A748A" }}>共 {total} 条</span>
      </div>

      {/* 表格（设计列：单号/材料/数量/调出/调入/状态/审计人/日期） */}
      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<TransferBill>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          locale={{ emptyText: "暂无调拨单" }}
          pagination={{ current: page, pageSize, total, showTotal: (t) => `共 ${t} 条`, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
        />
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#6A748A" }}>
          提示：调拨单明细逐条锁定库存；跨仓调拨审核通过后自动扣/增并回写库位
        </p>
      </div>

      <BillDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="库存调拨详情"
        statusTag={detail ? <Tag style={{ borderRadius: 999, background: STATUS_META[String(detail.status)]?.bg, color: STATUS_META[String(detail.status)]?.fg, borderColor: "transparent" }}>{STATUS_META[String(detail.status)]?.label}</Tag> : undefined}
        fields={[
          { label: "单号", value: detail?.bill_no },
          { label: "调出仓库", value: detail?.from_warehouse_name },
          { label: "调入仓库", value: detail?.to_warehouse_name },
          { label: "审计人", value: detail?.audit_name },
          { label: "创建时间", value: detail?.created_at?.slice(0, 16) },
          { label: "备注", value: detail?.remark, span: 2 },
        ]}
        columns={[
          { title: "材料", dataIndex: "product_name", render: (v, r) => <div><b>{v}</b><div style={{ fontSize: 11, color: "#5B6478" }}>{r.code}</div></div> },
          { title: "数量", dataIndex: "qty", width: 90, align: "right" as const },
          { title: "调出库位", dataIndex: "from_location_code", width: 130 },
          { title: "调入库位", dataIndex: "to_location_code", width: 130 },
        ]}
        rows={(detail?.items ?? []).map((it) => ({ ...it, key: it.id ?? it.product_id ?? Math.random() }))}
      />

      <Modal title="新建调拨" open={open} onOk={() => void create()} onCancel={() => setOpen(false)} width={720}>
        <Space style={{ marginBottom: 12 }}>
          <span>调出仓库</span>
          <Select style={{ width: 180 }} placeholder="选择" options={warehouses} fieldNames={{ label: "name", value: "id" }} value={form.from_warehouse_id || undefined} onChange={(v) => { setForm((f) => ({ ...f, from_warehouse_id: v })); void loadLocs(v); }} />
          <span>调入仓库</span>
          <Select style={{ width: 180 }} placeholder="选择" options={warehouses} fieldNames={{ label: "name", value: "id" }} value={form.to_warehouse_id || undefined} onChange={(v) => { setForm((f) => ({ ...f, to_warehouse_id: v })); void loadLocs(v); }} />
        </Space>
        {form.rows.map((r, i) => (
          <Space key={i} style={{ marginBottom: 8 }}>
            <Select style={{ width: 200 }} showSearch placeholder="材料" options={products} fieldNames={{ label: "name", value: "id" }} filterOption={(input, o) => String((o as { name?: string }).name ?? "").includes(input)} value={r.product_id} onChange={(v) => setRow(i, { product_id: v })} />
            <Select style={{ width: 130 }} placeholder="出库位" options={locs[form.from_warehouse_id] ?? []} fieldNames={{ label: "display", value: "id" }} value={r.from_location_id} onChange={(v) => setRow(i, { from_location_id: v })} />
            <Select style={{ width: 130 }} placeholder="入库位" options={locs[form.to_warehouse_id] ?? []} fieldNames={{ label: "display", value: "id" }} value={r.to_location_id} onChange={(v) => setRow(i, { to_location_id: v })} />
            <InputNumber min={0.001} placeholder="数量" value={r.qty} onChange={(v) => setRow(i, { qty: v ?? 0 })} />
            <Button size="small" danger onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((_, idx) => idx !== i) }))}>删</Button>
          </Space>
        ))}
        <Button block onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { product_id: undefined, from_location_id: undefined, to_location_id: undefined, qty: 1 }] }))}>+ 添加明细</Button>
      </Modal>
    </div>
  );
}
