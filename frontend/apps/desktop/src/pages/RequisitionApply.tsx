import { useEffect, useState } from "react";
import { App, Button, Card, Input, InputNumber, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router";

import { baseApi, requisitionApi, stockApi, useAuthStore, type Location, type Product, type StockRow, type Warehouse } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

interface Row {
  key: number;
  product_id: number | undefined;
  product: Product | null;
  location_id: number | undefined;
  qty: number;
}

/** 领用申请（电脑端，重做版）：申请信息 → 材料明细 → 使用信息 卡片化；提交即自动出库，随后手机端完成工作拍照进入审计。 */
export function RequisitionApplyPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [whId, setWhId] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [locs, setLocs] = useState<Location[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [useLocation, setUseLocation] = useState("");
  const [useReason, setUseReason] = useState("");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 仓管员/管理员代申请：可选申请人（使用者）
  const [applicants, setApplicants] = useState<{ id: number; real_name: string; username?: string }[]>([]);
  const [applicantId, setApplicantId] = useState(0);
  const canDelegate = useAuthStore((s) => s.hasPerm("req:audit")) || useAuthStore((s) => s.user?.role?.code === "super_admin");
  // 当前仓库各材料库存（设计页 26：库存不足黄标）
  const [stockMap, setStockMap] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    baseApi.warehouses().then((ws) => {
      const enabled = ws.filter((w) => w.status === 1);
      setWarehouses(enabled);
      if (enabled.length) setWhId(enabled[0].id);
    });
    baseApi.products("", 1).then((p) => setProducts(p.list)).catch(() => undefined);
    if (canDelegate) {
      requisitionApi.applicants().then(setApplicants).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换出库仓库 → 拉取该仓库库存，用于「库存不足」标注
  useEffect(() => {
    if (!whId) return;
    let alive = true;
    void (async () => {
      try {
        const all: StockRow[] = [];
        for (let p = 1; p <= 5; p++) {
          const d = await stockApi.query({ warehouse_id: whId, page: p, page_size: 100 });
          all.push(...d.list);
          if (all.length >= d.total) break;
        }
        if (!alive) return;
        const m = new Map<number, number>();
        for (const r of all) m.set(r.product_id, (m.get(r.product_id) ?? 0) + (Number(r.qty) || 0));
        setStockMap(m);
      } catch {
        /* 库存获取失败不阻塞领用 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [whId]);

  async function loadLocs(wh: number) {
    setLocs(await baseApi.locations(wh));
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, { key: Date.now() + rs.length, product_id: undefined, product: null, location_id: undefined, qty: 1 }]);
  }

  async function submit() {
    if (!whId) return message.warning("请选择出库仓库");
    if (!useLocation.trim()) return message.warning("使用地点为必填项");
    if (!useReason.trim()) return message.warning("因何使用为必填项");
    const items = rows
      .filter((r) => r.product_id && r.location_id && r.qty > 0)
      .map((r) => ({ product_id: r.product_id!, qty: String(r.qty), location_id: r.location_id! }));
    if (!items.length) return message.warning("请至少添加一条有效明细");
    setSubmitting(true);
    try {
      const data = await requisitionApi.create(whId, useLocation.trim(), useReason.trim(), items, remark.trim(), 0, applicantId);
      const name = applicants.find((a) => a.id === applicantId)?.real_name;
      message.success(`申请已提交：${data.bill_no}${name ? `（申请人：${name}）` : ""}（已自动出库，请在使用者手机端完成工作拍照）`);
      navigate("/requisitions/query");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  const totalQty = rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0);
  const validCount = rows.filter((r) => r.product_id && r.location_id && r.qty > 0).length;

  const columns: ColumnsType<Row> = [
    {
      title: "材料",
      width: 300,
      render: (_, r, i) => (
        <div>
          <Select
            style={{ width: "100%" }}
            showSearch
            placeholder="搜索材料（名称/编码/物料编码/规格）"
            options={products.map((p) => ({
              value: p.id,
              label: `${p.name}${p.spec ? `（${p.spec}）` : ""}${p.material_code ? ` · ${p.material_code}` : ""}`,
              name: p.name,
              code: p.material_code,
              spec: p.spec,
            }))}
            filterOption={(input, o) =>
              String((o as { name?: string }).name ?? "").includes(input) ||
              String((o as { code?: string }).code ?? "").includes(input) ||
              String((o as { spec?: string }).spec ?? "").includes(input)
            }
            value={r.product_id}
            onChange={(v) => {
              const p = products.find((x) => x.id === v);
              setRow(i, { product_id: v, product: p ?? null });
            }}
          />
          {r.product && (
            <div style={{ fontSize: 12, color: "#5B6478", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span>物料编码：{r.product.material_code || "-"} ｜ 规格：{r.product.spec || "-"} ｜ 单位：{r.product.unit_name || "-"}</span>
              {stockMap.has(r.product.id) && Number(r.qty) > (stockMap.get(r.product.id) ?? 0) && (
                <Tag color="warning" style={{ marginInlineEnd: 0 }}>库存不足（现 {stockMap.get(r.product.id)}）</Tag>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      title: "库位",
      width: 150,
      render: (_, r, i) => (
        <Select
          style={{ width: "100%" }}
          placeholder="选择"
          options={locs.map((l) => ({ label: l.display ?? l.code, value: l.id }))}
          value={r.location_id}
          onChange={(v) => setRow(i, { location_id: v })}
        />
      ),
    },
    { title: "数量", width: 110, render: (_, r, i) => <InputNumber min={0.001} value={r.qty} onChange={(v) => setRow(i, { qty: v ?? 0 })} style={{ width: "100%" }} /> },
    {
      title: "操作",
      width: 70,
      render: (_, r) => (
        <Button size="small" danger onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>删</Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h2 style={{ margin: "0 0 16px" }}>领用申请</h2>
      <Space style={{ marginBottom: 16 }} align="center">
        <Tag color="blue">提交即自动出库；随后需在使用者手机端「完成工作拍照」进入审计</Tag>
      </Space>

      <Card title="申请信息" size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {canDelegate && (
            <>
              <span>申请人</span>
              <Select
                style={{ width: 220 }}
                placeholder="默认：自己"
                allowClear
                options={applicants.map((a) => ({ label: `${a.real_name}（${a.username ?? a.id}）`, value: a.id }))}
                value={applicantId || undefined}
                onChange={(v) => setApplicantId(v ?? 0)}
              />
              <span style={{ color: "#5B6478", fontSize: 12 }}>仓管员/管理员可代使用者提交</span>
            </>
          )}
          <span>出库仓库</span>
          <Select
            style={{ width: 220 }}
            options={warehouses.map((w) => ({ label: w.name, value: w.id }))}
            value={whId || undefined}
            onChange={(v) => {
              setWhId(v);
              void loadLocs(v);
            }}
          />
        </Space>
      </Card>

      <Card
        title={`材料明细（${rows.length}）`}
        size="small"
        style={{ marginBottom: 16 }}
        extra={<Button size="small" onClick={addRow}>+ 添加材料</Button>}
      >
        <DataTable rowKey="key" size="middle" columns={columns} dataSource={rows} pagination={false} locale={{ emptyText: "暂无明细，点击右上角「添加材料」" }}  rowSelection onBatchDelete={async (keys) => { setRows((rs) => rs.filter((r) => !keys.includes(r.key))); }} />
      </Card>

      <Card title="使用信息" size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 500 }}>使用地点<span style={{ color: "#EF4444" }}>*</span></div>
            <Input placeholder="如：维修部 · 3 号线" value={useLocation} onChange={(e) => setUseLocation(e.target.value)} />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 500 }}>因何使用<span style={{ color: "#EF4444" }}>*</span></div>
            <Input placeholder="如：维修 XX 设备" value={useReason} onChange={(e) => setUseReason(e.target.value)} />
          </div>
        </div>
        <div>
          <div style={{ marginBottom: 6, fontWeight: 500 }}>备注（可选）</div>
          <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" />
        </div>
      </Card>

      <Space style={{ marginBottom: 24 }} align="center">
        <Button type="primary" size="large" loading={submitting} onClick={() => void submit()} style={{ minWidth: 180 }}>
          提交申请
        </Button>
        <span style={{ color: "#5B6478", fontSize: 12 }}>
          已填 {validCount}/{rows.length} 项材料，合计数量 {totalQty}
        </span>
      </Space>
    </div>
  );
}
