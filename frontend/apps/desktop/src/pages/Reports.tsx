import { useCallback, useEffect, useState } from "react";
import { Button, DatePicker, Select, Space, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";

import { baseApi, exportReportUrl, reportApi, type InventorySummaryRow, type StockReportRow, type Warehouse } from "@wlt/shared";

/** 报表中心（电脑端，管理者）：进销存汇总、库存报表、Excel 导出。 */
export function ReportsPage() {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: 0, marginBottom: 16 }}>报表中心</h2>
      <Tabs
        items={[
          { key: "inventory", label: "进销存汇总", children: <InventorySummaryTab /> },
          { key: "stock", label: "库存报表", children: <StockReportTab /> },
          { key: "flow", label: "库存流水导出", children: <FlowExportTab /> },
        ]}
      />
    </div>
  );
}

function useWarehouses(): Warehouse[] {
  const [whs, setWhs] = useState<Warehouse[]>([]);
  useEffect(() => {
    baseApi.warehouses().then(setWhs).catch(() => undefined);
  }, []);
  return whs;
}

function InventorySummaryTab() {
  const [whs] = [useWarehouses()];
  const [warehouseId, setWarehouseId] = useState(0);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [list, setList] = useState<InventorySummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const data = await reportApi.inventorySummary({
      warehouse_id: warehouseId || undefined,
      start: range?.[0]?.format("YYYY-MM-DD") ?? undefined,
      end: range?.[1]?.format("YYYY-MM-DD") ?? undefined,
      page,
    });
    setList(data.list);
    setTotal(data.total);
  }, [warehouseId, range, page]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const columns: ColumnsType<InventorySummaryRow> = [
    { title: "编码", dataIndex: "code", width: 120 },
    { title: "材料名称", dataIndex: "name" },
    { title: "规格", dataIndex: "spec", width: 120 },
    { title: "单位", dataIndex: "unit_name", width: 70 },
    { title: "期初数量", dataIndex: "opening_qty", width: 100, align: "right" },
    { title: "入库数量", dataIndex: "in_qty", width: 100, align: "right" },
    { title: "出库数量", dataIndex: "out_qty", width: 100, align: "right" },
    { title: "结存数量", dataIndex: "closing_qty", width: 100, align: "right" },
    { title: "结存金额", dataIndex: "closing_amount", width: 110, align: "right" },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 200 }}
          placeholder="全部仓库"
          allowClear
          options={whs.map((w) => ({ label: w.name, value: w.id }))}
          value={warehouseId || undefined}
          onChange={(v) => { setWarehouseId(v ?? 0); setPage(1); }}
        />
        <DatePicker.RangePicker value={range} onChange={(v) => { setRange(v as [Dayjs | null, Dayjs | null] | null); setPage(1); }} />
        <Button type="primary" onClick={() => void load()}>查询</Button>
        <Button
          onClick={() =>
            window.open(
              exportReportUrl({
                type: "inventory-summary",
                warehouse_id: warehouseId || undefined,
                start: range?.[0]?.format("YYYY-MM-DD"),
                end: range?.[1]?.format("YYYY-MM-DD"),
              })
            )
          }
        >
          导出 Excel
        </Button>
      </Space>
      <Table rowKey="product_id" size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize: 20, total, onChange: setPage }} />
    </div>
  );
}

const SORT_LABELS: Record<string, string> = { qty: "按数量", amount: "按金额", turnover: "按周转（30天出库+呆滞）" };

function StockReportTab() {
  const whs = useWarehouses();
  const [warehouseId, setWarehouseId] = useState(0);
  const [sort, setSort] = useState<"qty" | "amount" | "turnover">("qty");
  const [list, setList] = useState<StockReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const data = await reportApi.stock({ warehouse_id: warehouseId || undefined, sort, page });
    setList(data.list);
    setTotal(data.total);
  }, [warehouseId, sort, page]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const columns: ColumnsType<StockReportRow> = [
    { title: "编码", dataIndex: "code", width: 120 },
    { title: "材料名称", dataIndex: "name" },
    { title: "规格", dataIndex: "spec", width: 120 },
    { title: "仓库", dataIndex: "warehouse_name", width: 110 },
    { title: "数量", dataIndex: "qty", width: 90, align: "right" },
    { title: "成本价", dataIndex: "cost_price", width: 90, align: "right" },
    { title: "金额", dataIndex: "amount", width: 100, align: "right" },
    { title: "30天出库", dataIndex: "out_qty_30d", width: 90, align: "right" },
    { title: "最近变动", dataIndex: "last_moved_at", width: 150, render: (v: string) => v || "-" },
    {
      title: "状态",
      width: 90,
      render: (_, r) => (r.dormant_days > 90 ? <Tag color="red">呆滞 {r.dormant_days} 天</Tag> : <Tag color="default">正常</Tag>),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 200 }}
          placeholder="全部仓库"
          allowClear
          options={whs.map((w) => ({ label: w.name, value: w.id }))}
          value={warehouseId || undefined}
          onChange={(v) => { setWarehouseId(v ?? 0); setPage(1); }}
        />
        <Select
          style={{ width: 220 }}
          value={sort}
          options={Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => { setSort(v); setPage(1); }}
        />
        <Button type="primary" onClick={() => void load()}>查询</Button>
        <Button onClick={() => window.open(exportReportUrl({ type: "stock", warehouse_id: warehouseId || undefined, sort }))}>
          导出 Excel
        </Button>
      </Space>
      <Table rowKey={(r) => `${r.product_id}-${r.warehouse_name}`} size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize: 20, total, onChange: setPage }} />
    </div>
  );
}

function FlowExportTab() {
  const [billNo, setBillNo] = useState("");
  const [changeType, setChangeType] = useState("");
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  return (
    <div>
      <p style={{ color: "#999", fontSize: 12 }}>
        按条件导出库存流水明细（stk_stock_log）。条件可留空（全量导出，数据量大时建议限定日期）。
      </p>
      <Space wrap>
        <input
          placeholder="单据号（模糊）"
          value={billNo}
          onChange={(e) => setBillNo(e.target.value)}
          style={{ padding: "4px 8px", border: "1px solid #d9d9d9", borderRadius: 6 }}
        />
        <input
          placeholder="变动类型（如：采购入库）"
          value={changeType}
          onChange={(e) => setChangeType(e.target.value)}
          style={{ padding: "4px 8px", border: "1px solid #d9d9d9", borderRadius: 6 }}
        />
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as [Dayjs | null, Dayjs | null] | null)} />
        <Button
          type="primary"
          onClick={() =>
            window.open(
              exportReportUrl({
                type: "flow",
                bill_no: billNo || undefined,
                change_type: changeType || undefined,
                start: range?.[0]?.format("YYYY-MM-DD"),
                end: range?.[1]?.format("YYYY-MM-DD"),
              })
            )
          }
        >
          导出 Excel
        </Button>
      </Space>
    </div>
  );
}
