import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, InputNumber, message, Modal, Popconfirm, Select, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useSearchParams } from "react-router-dom";

import { baseApi, purchaseApi, purchaseIn, type PurchaseInBill } from "@wlt/shared";

interface Row {
  product_id: number | undefined;
  location_id: number | undefined;
  qty: number;
  price: number;
}

/** OCR 预填条目（送货单识别结果带入）。 */
interface PrefillItem {
  product_name: string;
  qty?: string;
  price?: string;
}

export function PurchaseInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [list, setList] = useState<PurchaseInBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: number; name: string; code: string }[]>([]);
  const [locs, setLocs] = useState<{ id: number; code: string }[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [rows, setRows] = useState<Row[]>([]);
  const [prefillHits, setPrefillHits] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    const data = await purchaseApi.list(page);
    setList(data.list);
    setTotal(data.total);
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.warehouses().then((ws) => setWarehouses(ws.filter((w) => w.status === 1).map((w) => ({ id: w.id, name: w.name }))));
    baseApi.products("", 1).then((p) => setProducts(p.list));
  }, []);

  // 从送货单 OCR 结果预填明细（?items=JSON）
  const prefill: PrefillItem[] = useMemo(() => {
    try {
      const raw = params.get("items");
      return raw ? (JSON.parse(decodeURIComponent(raw)) as PrefillItem[]) : [];
    } catch {
      return [];
    }
  }, [params]);

  useEffect(() => {
    if (!prefill.length || open) return;
    setOpen(true);
    void (async () => {
      const matched: Row[] = [];
      const hits: Record<number, boolean> = {};
      for (const it of prefill) {
        const found = await baseApi.products(it.product_name);
        const p = found.list.find((x) => x.name === it.product_name) ?? found.list[0];
        matched.push({
          product_id: p?.id,
          location_id: undefined,
          qty: Number(it.qty ?? 1),
          price: Number(it.price ?? 0),
        });
        hits[matched.length - 1] = Boolean(p);
      }
      setRows(matched);
      setPrefillHits(hits);
      if (Object.values(hits).some((h) => !h)) {
        message.warning("部分商品未匹配到系统资料，请手动选择");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill.length]);

  async function loadLocs(whId: number) {
    setLocs((await baseApi.locations(whId)).map((l) => ({ id: l.id, code: l.code })));
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function create() {
    if (!warehouseId) return message.warning("请选择入库仓库");
    const items = rows
      .filter((r) => r.product_id && r.location_id && r.qty > 0)
      .map((r) => ({ product_id: r.product_id!, qty: String(r.qty), price: String(r.price || 0), location_id: r.location_id! }));
    if (!items.length) return message.warning("请至少添加一条有效明细");
    try {
      const data = await purchaseIn(warehouseId, items);
      message.success(`入库成功：${data.bill_no}`);
      setOpen(false);
      setRows([]);
      navigate("/purchase-in", { replace: true });
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "入库失败");
    }
  }

  const columns: ColumnsType<PurchaseInBill> = [
    { title: "单号", dataIndex: "bill_no" },
    { title: "仓库", dataIndex: "warehouse_name" },
    { title: "供应商", dataIndex: "supplier_name" },
    { title: "数量", dataIndex: "total_qty" },
    { title: "金额", dataIndex: "total_amount" },
    { title: "日期", dataIndex: "bill_date" },
    {
      title: "操作",
      render: (_, r) =>
        r.status === 1 ? (
          <Popconfirm title="确认作废（反向冲销库存，仅当日）？" onConfirm={async () => { try { await purchaseApi.void(r.id); message.success("已作废"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
            <Button size="small" danger>作废</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>采购入库</h2>
        <Button type="primary" onClick={() => setOpen(true)}>新建入库</Button>
        <Button onClick={() => navigate("/ocr/delivery")}>送货单 OCR 录入</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={list} pagination={{ current: page, pageSize: 20, total, onChange: setPage }} />

      <Modal title="新建采购入库" open={open} onOk={() => void create()} onCancel={() => setOpen(false)} width={760}>
        <Space style={{ marginBottom: 12 }}>
          <span>仓库</span>
          <Select style={{ width: 220 }} placeholder="选择" options={warehouses} fieldNames={{ label: "name", value: "id" }} value={warehouseId} onChange={(v) => { setWarehouseId(v); void loadLocs(v); }} />
          <Button size="small" onClick={() => navigate("/ocr/delivery")}>送货单 OCR 识别带入</Button>
        </Space>
        {rows.map((r, i) => (
          <Space key={i} style={{ marginBottom: 8 }}>
            <Select
              style={{ width: 200 }}
              showSearch
              placeholder="商品"
              options={products}
              fieldNames={{ label: "name", value: "id" }}
              filterOption={(input, o) => String((o as { name?: string }).name ?? "").includes(input)}
              value={r.product_id}
              onChange={(v) => setRow(i, { product_id: v })}
              status={prefillHits[i] === false ? "error" : undefined}
            />
            <Select style={{ width: 130 }} placeholder="库位" options={locs} fieldNames={{ label: "code", value: "id" }} value={r.location_id} onChange={(v) => setRow(i, { location_id: v })} />
            <InputNumber min={0.001} placeholder="数量" value={r.qty} onChange={(v) => setRow(i, { qty: v ?? 0 })} />
            <InputNumber min={0} placeholder="进价" value={r.price} onChange={(v) => setRow(i, { price: v ?? 0 })} />
            <Button size="small" danger onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>删</Button>
          </Space>
        ))}
        <Button block onClick={() => setRows((rs) => [...rs, { product_id: undefined, location_id: undefined, qty: 1, price: 0 }])}>+ 添加明细</Button>
      </Modal>
    </div>
  );
}
