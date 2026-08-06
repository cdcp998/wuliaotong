import { useCallback, useEffect, useState } from "react";
import { App, Button, DatePicker, Select, Space, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";

import { baseApi, exportReportUrl, reportApi, type InventorySummaryRow, type StockReportRow, type Warehouse } from "@wlt/shared";

import dayjs from "dayjs";

import { DataTable } from "../components/DataTable";

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
          { key: "ai", label: "AI 月报摘要", children: <AiSummaryTab /> },
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
  const { message } = App.useApp();
  const [whs] = [useWarehouses()];
  const [warehouseId, setWarehouseId] = useState(0);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [list, setList] = useState<InventorySummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    const data = await reportApi.inventorySummary({
      warehouse_id: warehouseId || undefined,
      start: range?.[0]?.format("YYYY-MM-DD") ?? undefined,
      end: range?.[1]?.format("YYYY-MM-DD") ?? undefined,
      page,
      page_size: pageSize,
    });
    setList(data.list);
    setTotal(data.total);
  }, [warehouseId, range, page, pageSize]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const columns: ColumnsType<InventorySummaryRow> = [
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
      <DataTable rowKey="product_id" size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}  rowSelection onBatchDelete={async () => { message.info("该列表为只读数据，不支持删除"); }} />
    </div>
  );
}

const SORT_LABELS: Record<string, string> = { qty: "按数量", amount: "按金额", turnover: "按周转（30天出库+呆滞）" };

function StockReportTab() {
  const { message } = App.useApp();
  const whs = useWarehouses();
  const [warehouseId, setWarehouseId] = useState(0);
  const [sort, setSort] = useState<"qty" | "amount" | "turnover">("qty");
  const [list, setList] = useState<StockReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    const data = await reportApi.stock({ warehouse_id: warehouseId || undefined, sort, page, page_size: pageSize });
    setList(data.list);
    setTotal(data.total);
  }, [warehouseId, sort, page, pageSize]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const columns: ColumnsType<StockReportRow> = [
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
      <DataTable rowKey={(r) => `${r.product_id}-${r.warehouse_name}`} size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}  rowSelection onBatchDelete={async () => { message.info("该列表为只读数据，不支持删除"); }} />
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
          placeholder="变动类型（如：入库）"
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


/** AI 月报摘要（P9-P1⑦）：选择日期范围 → DeepSeek 生成经营摘要（未配置降级规则版）。 */
function AiSummaryTab() {
  const { message } = App.useApp();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>([dayjs().startOf("month"), dayjs()]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string>("");
  const [ai, setAi] = useState(false);

  async function generate() {
    if (!range?.[0] || !range?.[1]) {
      message.warning("请选择日期范围（默认本月）");
      return;
    }
    setLoading(true);
    try {
      const r = await reportApi.aiSummary(range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"));
      setSummary(r.summary);
      setAi(r.ai);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <Space style={{ marginBottom: 12 }} wrap>
        <span>日期范围</span>
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as [Dayjs | null, Dayjs | null] | null)} />
        <Button type="primary" loading={loading} onClick={() => void generate()}>生成 AI 月报摘要</Button>
      </Space>
      {summary && (
        <div style={{ border: "1px solid #e5e6eb", borderRadius: 8, padding: 16, background: "#fafbfc", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
          <Typography.Paragraph>{summary}</Typography.Paragraph>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {ai ? "AI 生成，仅供参考" : "规则版摘要（文本模型未配置或生成失败）"} · {range?.[0]?.format("YYYY-MM-DD")} ~ {range?.[1]?.format("YYYY-MM-DD")}
          </Typography.Text>
        </div>
      )}
    </div>
  );
}
