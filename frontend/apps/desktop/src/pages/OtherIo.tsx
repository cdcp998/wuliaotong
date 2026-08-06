import { useCallback, useEffect, useState } from "react";
import { App, Button, InputNumber, Modal, Popconfirm, Radio, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, otherIoApi, type OtherIoBill, type OtherIoDetail } from "@wlt/shared";

import { BillDetailDrawer } from "../components/BillDetailDrawer";

const IO_TYPES = ["报废", "报损", "赠品出", "其他出"];

interface Row {
  product_id: number | undefined;
  location_id: number | undefined;
  qty: number;
}

export function OtherIoPage() {
  const { message } = App.useApp();
  const [ioType, setIoType] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<OtherIoBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: number; name: string; code: string }[]>([]);
  const [locs, setLocs] = useState<{ id: number; code: string }[]>([]);
  const [form, setForm] = useState({ ioType: IO_TYPES[0], warehouse_id: 0, rows: [] as Row[] });
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<OtherIoDetail | null>(null);

  async function openDetail(r: OtherIoBill) {
    try {
      setDetail(await otherIoApi.detail(r.id));
      setDetailOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
    const data = await otherIoApi.list(ioType, undefined, page);
    setList(data.list);
    setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [ioType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.warehouses().then((ws) => setWarehouses(ws.filter((w) => w.status === 1).map((w) => ({ id: w.id, name: w.name }))));
    baseApi.products("", 1).then((p) => setProducts(p.list));
  }, []);

  async function loadLocs(whId: number) {
    setLocs((await baseApi.locations(whId)).map((l) => ({ id: l.id, code: l.code })));
  }

  function setRow(i: number, patch: Partial<Row>) {
    setForm((f) => ({ ...f, rows: f.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }

  async function create() {
    const items = form.rows
      .filter((r) => r.product_id && r.location_id && r.qty > 0)
      .map((r) => ({ product_id: r.product_id!, qty: String(r.qty), location_id: r.location_id! }));
    if (!items.length) return message.warning("请至少添加一条有效明细");
    try {
      const data = await otherIoApi.create(form.ioType, form.warehouse_id, items);
      message.success(`${form.ioType}成功：${data.bill_no}`);
      setOpen(false);
      setForm({ ioType: IO_TYPES[0], warehouse_id: 0, rows: [] });
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  const columns: ColumnsType<OtherIoBill> = [
    { title: "单号", dataIndex: "bill_no", render: (v: string, r) => <a onClick={() => void openDetail(r)}>{v}</a> },
    { title: "类型", dataIndex: "io_type" },
    { title: "仓库", dataIndex: "warehouse_name" },
    { title: "操作人", dataIndex: "operator_name" },
    { title: "状态", dataIndex: "status", render: (s: number) => ({ 1: "已过账", "-1": "已作废" })[String(s)] ?? s },
    {
      title: "操作",
      render: (_, r) =>
        r.status === 1 ? (
          <Popconfirm title="确认作废（反向冲销库存）？" onConfirm={async () => { try { await otherIoApi.void(r.id); message.success("已作废"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
            <Button size="small" danger>作废</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>其他出入库</h2>
        <Radio.Group value={ioType} onChange={(e) => { setIoType(e.target.value); setPage(1); }} optionType="button" size="small">
          <Radio.Button value={undefined}>全部</Radio.Button>
          {IO_TYPES.map((t) => (
            <Radio.Button key={t} value={t}>{t}</Radio.Button>
          ))}
        </Radio.Group>
        <Button type="primary" onClick={() => setOpen(true)}>新建</Button>
      </Space>
      <Table rowKey="id" loading={loading} columns={columns} dataSource={list} pagination={{ current: page, pageSize: 20, total, onChange: setPage }} />

      <BillDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="其他出入库详情"
        statusTag={detail ? <Tag color={detail.status === 1 ? "green" : "default"}>{detail.status === 1 ? "已过账" : "已作废"}</Tag> : undefined}
        fields={[
          { label: "单号", value: detail?.bill_no },
          { label: "类型", value: detail?.io_type },
          { label: "仓库", value: detail?.warehouse_name },
          { label: "操作人", value: detail?.operator_name },
          { label: "时间", value: detail?.created_at?.slice(0, 16) },
          { label: "备注", value: detail?.remark, span: 2 },
        ]}
        columns={[
          { title: "材料", dataIndex: "product_name", render: (v, r) => <div><b>{v}</b><div style={{ fontSize: 11, color: "#86909c" }}>{r.code}{r.spec ? ` / ${r.spec}` : ""}</div></div> },
          { title: "库位", dataIndex: "location_code", width: 120 },
          { title: "数量", dataIndex: "qty", width: 90, align: "right" as const },
        ]}
        rows={(detail?.items ?? []).map((it) => ({ ...it, key: it.id ?? it.product_id ?? Math.random() }))}
      />

      <Modal title="新建其他出入库" open={open} onOk={() => void create()} onCancel={() => setOpen(false)} width={680}>
        <Space style={{ marginBottom: 12 }}>
          <span>类型</span>
          <Select style={{ width: 140 }} options={IO_TYPES.map((t) => ({ label: t, value: t }))} value={form.ioType} onChange={(v) => setForm((f) => ({ ...f, ioType: v }))} />
          <span>仓库</span>
          <Select style={{ width: 180 }} placeholder="选择" options={warehouses} fieldNames={{ label: "name", value: "id" }} value={form.warehouse_id || undefined} onChange={(v) => { setForm((f) => ({ ...f, warehouse_id: v })); void loadLocs(v); }} />
        </Space>
        {form.rows.map((r, i) => (
          <Space key={i} style={{ marginBottom: 8 }}>
            <Select style={{ width: 200 }} showSearch placeholder="材料" options={products} fieldNames={{ label: "name", value: "id" }} filterOption={(input, o) => String((o as { name?: string }).name ?? "").includes(input)} value={r.product_id} onChange={(v) => setRow(i, { product_id: v })} />
            <Select style={{ width: 140 }} placeholder="库位" options={locs} fieldNames={{ label: "code", value: "id" }} value={r.location_id} onChange={(v) => setRow(i, { location_id: v })} />
            <InputNumber min={0.001} placeholder="数量" value={r.qty} onChange={(v) => setRow(i, { qty: v ?? 0 })} />
            <Button size="small" danger onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((_, idx) => idx !== i) }))}>删</Button>
          </Space>
        ))}
        <Button block onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { product_id: undefined, location_id: undefined, qty: 1 }] }))}>+ 添加明细</Button>
      </Modal>
    </div>
  );
}
