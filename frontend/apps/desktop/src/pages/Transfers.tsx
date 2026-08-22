import { useCallback, useEffect, useState } from "react";
import { App, Button, InputNumber, Modal, Popconfirm, Radio, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, transferApi, type TransferBill, type TransferDetail } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

import { BillDetailDrawer } from "../components/BillDetailDrawer";

const STATUS: Record<string, string> = { 0: "草稿", 1: "已审核", "-1": "已作废", "-2": "已驳回" };

interface Row {
  product_id: number | undefined;
  from_location_id: number | undefined;
  to_location_id: number | undefined;
  qty: number;
}

export function TransfersPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<number | undefined>();
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
    const data = await transferApi.list(status, page, pageSize);
    setList(data.list);
    setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [status, page, pageSize]);

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

  const columns: ColumnsType<TransferBill> = [
    { title: "单号", dataIndex: "bill_no", render: (v: string, r) => <a onClick={() => void openDetail(r)}>{v}</a> },
    { title: "调出仓库", dataIndex: "from_warehouse_name" },
    { title: "调入仓库", dataIndex: "to_warehouse_name" },
    { title: "状态", dataIndex: "status", render: (s: number) => STATUS[String(s)] ?? s },
    { title: "审计人", dataIndex: "audit_name" },
    {
      title: "操作",
      render: (_, r) => (
        <Space>
          {r.status === 0 && (
            <>
              <Popconfirm title="确认审核过账？" onConfirm={async () => { try { await transferApi.audit(r.id); message.success("已审核"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
                <Button size="small" type="primary">通过</Button>
              </Popconfirm>
              <Popconfirm title="确认驳回该调拨单？" onConfirm={async () => { try { await transferApi.reject(r.id); message.success("已驳回"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
                <Button size="small" danger>驳回</Button>
              </Popconfirm>
            </>
          )}
          {r.status !== -1 && (
            <Popconfirm title="确认作废？" onConfirm={async () => { try { await transferApi.void(r.id); message.success("已作废"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
              <Button size="small" danger>作废</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>库存调拨</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Radio.Group value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} optionType="button" size="small">
          <Radio.Button value={undefined}>全部</Radio.Button>
          <Radio.Button value={0}>草稿</Radio.Button>
          <Radio.Button value={1}>已审核</Radio.Button>
          <Radio.Button value={-1}>已作废</Radio.Button>
          <Radio.Button value={-2}>已驳回</Radio.Button>
        </Radio.Group>
        <Button type="primary" onClick={() => setOpen(true)}>新建调拨</Button>
      </Space>
      <DataTable rowKey="id" loading={loading} columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}  rowSelection
        batchActions={[
          { label: "批量通过", onClick: async (keys) => { for (const k of keys) await transferApi.audit(Number(k)); message.success(`已通过 ${keys.length} 张调拨单`); void load(); } },
          { label: "批量拒绝", danger: true, confirm: "确定驳回选中的调拨单吗？", onClick: async (keys) => { for (const k of keys) await transferApi.reject(Number(k)); message.success(`已驳回 ${keys.length} 张调拨单`); void load(); } },
          { label: "批量删除", danger: true, confirm: "确定作废选中的调拨单吗？（已审核单将反向冲销库存）", onClick: async (keys) => { for (const k of keys) await transferApi.void(Number(k)); message.success(`已作废 ${keys.length} 张调拨单`); void load(); } },
        ]} />

      <BillDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="库存调拨详情"
        statusTag={detail ? <Tag color={detail.status === 1 ? "green" : detail.status === 0 ? "gold" : "default"}>{STATUS[String(detail.status)] ?? detail.status}</Tag> : undefined}
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
