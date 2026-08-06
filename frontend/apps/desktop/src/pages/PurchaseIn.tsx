import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useSearchParams } from "react-router-dom";

import { baseApi, purchaseApi, purchaseIn, type Product, type PurchaseInBill, type PurchaseInDetail } from "@wlt/shared";

import { BillDetailDrawer } from "../components/BillDetailDrawer";

interface Row {
  product_id: number | undefined;
  product?: Product | null; // 选中材料快照（显示物料编码/名称/规格/单位）
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
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [list, setList] = useState<PurchaseInBill[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PurchaseInDetail | null>(null);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locs, setLocs] = useState<{ id: number; code: string }[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [rows, setRows] = useState<Row[]>([]);
  const [prefillHits, setPrefillHits] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
    const data = await purchaseApi.list(page);
    setList(data.list);
    setTotal(data.total);
    } finally {
      setLoading(false);
    }
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
          product: p ?? null,
          location_id: undefined,
          qty: Number(it.qty ?? 1),
          price: Number(it.price ?? 0),
        });
        hits[matched.length - 1] = Boolean(p);
      }
      setRows(matched);
      setPrefillHits(hits);
      if (Object.values(hits).some((h) => !h)) {
        message.warning("部分材料未匹配到系统资料，请手动选择");
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
    {
      title: "单号",
      dataIndex: "bill_no",
      render: (v: string, r) => (
        <a
          onClick={async () => {
            try {
              setDetail(await purchaseApi.detail(r.id));
              setDetailOpen(true);
            } catch (e) {
              message.error(e instanceof Error ? e.message : "加载失败");
            }
          }}
        >
          {v}
        </a>
      ),
    },
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
      <Table rowKey="id" loading={loading} columns={columns} dataSource={list} pagination={{ current: page, pageSize: 20, total, onChange: setPage }} />

      <BillDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="采购入库详情"
        statusTag={detail ? <Tag color={detail.status === 1 ? "green" : "default"}>{detail.status === 1 ? "已入库" : "已作废"}</Tag> : undefined}
        fields={[
          { label: "单号", value: detail?.bill_no },
          { label: "仓库", value: detail?.warehouse_name },
          { label: "供应商", value: detail?.supplier_name },
          { label: "入库日期", value: detail?.bill_date?.slice(0, 16) },
          { label: "总数量", value: detail?.total_qty },
          { label: "总金额", value: detail?.total_amount },
          { label: "备注", value: detail?.remark, span: 2 },
        ]}
        columns={[
          { title: "材料", dataIndex: "product_name", render: (v, r) => <div><b>{v}</b><div style={{ fontSize: 11, color: "#86909c" }}>{r.code}{r.spec ? ` / ${r.spec}` : ""}</div></div> },
          { title: "库位", dataIndex: "location_code", width: 120 },
          { title: "数量", dataIndex: "qty", width: 90, align: "right" as const },
          { title: "单价", dataIndex: "price", width: 90, align: "right" as const },
          { title: "金额", dataIndex: "amount", width: 100, align: "right" as const },
        ]}
        rows={(detail?.items ?? []).map((it) => ({ ...it, key: it.id ?? it.product_id ?? Math.random() }))}
      />

      <Modal title="新建采购入库" open={open} onOk={() => void create()} onCancel={() => setOpen(false)} width={760}>
        <Space style={{ marginBottom: 12 }}>
          <span>仓库</span>
          <Select style={{ width: 220 }} placeholder="选择" options={warehouses} fieldNames={{ label: "name", value: "id" }} value={warehouseId} onChange={(v) => { setWarehouseId(v); void loadLocs(v); }} />
          <Button size="small" onClick={() => navigate("/ocr/delivery")}>送货单 OCR 识别带入</Button>
        </Space>
        {rows.map((r, i) => (
          <div key={i} style={{ marginBottom: 10, padding: 10, border: "1px solid #f0f1f3", borderRadius: 8, background: "#fafbfc" }}>
            <Space style={{ marginBottom: 6 }} wrap>
            <Select
              style={{ width: 260 }}
              showSearch
              placeholder="材料名称 / 物料编码 / 型号规格"
              options={products.map((p) => ({
                value: p.id,
                label: `${p.name}${p.spec ? `（${p.spec}）` : ""}${p.material_code ? ` · ${p.material_code}` : ""}`,
                name: p.name,
                code: p.material_code,
                spec: p.spec,
              }))}
              filterOption={(input, o) =>
                String((o as { name?: string; code?: string; spec?: string }).name ?? "").includes(input) ||
                String((o as { name?: string; code?: string; spec?: string }).code ?? "").includes(input) ||
                String((o as { name?: string; code?: string; spec?: string }).spec ?? "").includes(input)
              }
              value={r.product_id}
              onChange={(v) => {
                const p = products.find((x) => x.id === v);
                setRow(i, { product_id: v, product: p ?? null });
              }}
              status={prefillHits[i] === false ? "error" : undefined}
            />
            <Select style={{ width: 130 }} placeholder="库位" options={locs} fieldNames={{ label: "code", value: "id" }} value={r.location_id} onChange={(v) => setRow(i, { location_id: v })} />
            <InputNumber min={0.001} placeholder="数量" value={r.qty} onChange={(v) => setRow(i, { qty: v ?? 0 })} />
            <InputNumber min={0} placeholder="进价" value={r.price} onChange={(v) => setRow(i, { price: v ?? 0 })} />
            <Button size="small" danger onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>删</Button>
            </Space>
            <div style={{ fontSize: 12, color: "#86909c", marginTop: 4 }}>
              物料编码：{r.product?.material_code || "-"} ｜ 型号规格：{r.product?.spec || "-"} ｜ 单位：{r.product?.unit_name || "-"}
            </div>
          </div>
        ))}
        <Button block onClick={() => setRows((rs) => [...rs, { product_id: undefined, product: null, location_id: undefined, qty: 1, price: 0 }])}>+ 添加明细</Button>
      </Modal>
    </div>
  );
}
