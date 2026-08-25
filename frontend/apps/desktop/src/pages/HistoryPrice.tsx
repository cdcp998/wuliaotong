import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, SearchOutlined } from "@ant-design/icons";

import { baseApi, purchaseApi, type HistoryPriceRow, type Supplier } from "@wlt/shared";

const RANGE_OPTIONS = [
  { value: 0, label: "全部时间" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
  { value: 180, label: "近半年" },
];

/** 时间范围 → 起始日期（YYYY-MM-DD）。 */
function startOf(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** 历史价格管理（设计页 21，库存管理）：按材料 × 供应商 查看历史采购价，入库时自动提示涨跌（移动加权成本）。 */
export function HistoryPricePage() {
  const { message } = App.useApp();
  const [list, setList] = useState<HistoryPriceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [supplierId, setSupplierId] = useState(0);
  const [rangeDays, setRangeDays] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
      const data = await purchaseApi.historyPrice({ keyword, supplierId, start: rangeDays ? startOf(rangeDays) : undefined, page, pageSize });
      setList(data.list);
      setTotal(data.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, supplierId, rangeDays, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.suppliers().then((d) => setSuppliers(d.list)).catch(() => undefined);
  }, []);

  /** 涨跌对比（设计页 21）：列表按入库日期倒序，同一「材料×供应商」相邻两笔的价格差。
   * 当前行 vs 上一笔（更早）采购：正=涨(红)、负=跌(绿)、0=持平(中性)。 */
  const changeMap = useMemo(() => {
    const groupIdx = new Map<string, number[]>();
    list.forEach((r, i) => {
      const k = `${r.product_id}-${r.supplier_id}`;
      if (!groupIdx.has(k)) groupIdx.set(k, []);
      groupIdx.get(k)!.push(i);
    });
    const map = new Map<number, { dir: "up" | "down" | "flat"; diff: number; pct: number }>();
    for (const idxs of groupIdx.values()) {
      for (let n = 0; n < idxs.length; n++) {
        const i = idxs[n];
        const j = idxs[n + 1];
        if (j === undefined) continue;
        const cur = Number(list[i].price) || 0;
        const prev = Number(list[j].price) || 0;
        const diff = cur - prev;
        map.set(i, { dir: diff > 0 ? "up" : diff < 0 ? "down" : "flat", diff, pct: prev !== 0 ? (diff / prev) * 100 : 0 });
      }
    }
    return map;
  }, [list]);

  function renderChange(r: HistoryPriceRow) {
    const c = changeMap.get(list.indexOf(r));
    if (!c) return <span style={{ color: "#8A93A8", fontSize: 12 }}>首笔 —</span>;
    const sign = c.dir === "up" ? "+" : c.dir === "down" ? "-" : "";
    const text = c.dir === "flat" ? "持平" : `${sign}${Math.abs(c.pct).toFixed(1)}%`;
    const meta = c.dir === "up" ? { fg: "#DC2626", bg: "#FDEBEC" } : c.dir === "down" ? { fg: "#15803D", bg: "#E8F9EF" } : { fg: "#5B6478", bg: "#EFF3FC" };
    return <Tag style={{ borderRadius: 999, background: meta.bg, color: meta.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{text}</Tag>;
  }

  /** 导出当前筛选（CSV）。 */
  async function onExport() {
    try {
      const all: HistoryPriceRow[] = [];
      for (let p = 1; p <= 20; p++) {
        const d = await purchaseApi.historyPrice({ keyword, supplierId, start: rangeDays ? startOf(rangeDays) : undefined, page: p, pageSize: 100 });
        all.push(...d.list);
        if (all.length >= d.total) break;
      }
      const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const csv = [
        ["材料", "编码", "供应商", "单价", "涨跌", "单据", "日期"].join(","),
        ...all.map((r) => {
          const c = changeMap.get(list.indexOf(r));
          const ch = !c ? "首笔" : c.dir === "flat" ? "持平" : `${c.dir === "up" ? "+" : "-"}${Math.abs(c.pct).toFixed(1)}%`;
          return [r.product_name, r.material_code || "-", r.supplier_name, r.price, ch, r.bill_no, r.bill_date?.slice(0, 10)].map(esc).join(",");
        }),
      ].join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `历史价格_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    }
  }

  const columns: ColumnsType<HistoryPriceRow> = [
    {
      title: "材料", key: "name", width: 280,
      render: (_, r) => (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1E2433" }}>{r.product_name}</span>
          <span style={{ fontSize: 10.5, color: "#8A93A8" }}>{r.material_code || "-"}</span>
        </span>
      ),
    },
    { title: "供应商", dataIndex: "supplier_name", render: (v: string) => <span style={{ fontSize: 12.5, color: "#5B6478" }}>{v || "—"}</span> },
    { title: "单价", dataIndex: "price", width: 110, render: (v: string) => <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>¥ {Number(v || 0).toFixed(2)}</span> },
    { title: "涨跌", key: "change", width: 100, render: (_, r) => renderChange(r) },
    { title: "单据", dataIndex: "bill_no", width: 170, render: (v: string) => <span style={{ fontSize: 12, color: "#5B6478", fontVariantNumeric: "tabular-nums" }}>{v}</span> },
    { title: "日期", dataIndex: "bill_date", width: 120, render: (v: string) => <span style={{ fontSize: 12, color: "#8A93A8", fontVariantNumeric: "tabular-nums" }}>{v?.slice(0, 10)}</span> },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 21） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>历史价格管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#5B6478" }}>
            按 材料 × 供应商 查看历史采购价，入库时自动提示涨跌（移动加权成本）
          </p>
        </div>
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => void onExport()}>导出</Button>
      </div>

      {/* 筛选条（设计页 21：搜索 + 供应商 + 近 N 天 + 统计） */}
      <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#8A93A8" }} />}
          placeholder="材料 / 供应商"
          allowClear
          style={{ width: 300, background: "#F6F8FE" }}
          onChange={(e) => { if (!e.target.value) { setKeyword(""); setPage(1); } }}
          onPressEnter={(e) => { setKeyword((e.target as HTMLInputElement).value.trim()); setPage(1); }}
        />
        <Select
          placeholder="全部供应商"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 180 }}
          options={suppliers.map((s) => ({ label: s.name, value: s.id }))}
          value={supplierId || undefined}
          onChange={(v) => { setSupplierId(v ?? 0); setPage(1); }}
        />
        <Select
          style={{ width: 180 }}
          options={RANGE_OPTIONS}
          value={rangeDays}
          onChange={(v) => { setRangeDays(v); setPage(1); }}
        />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A93A8" }}>共 {total} 条记录</span>
      </div>

      {/* 表格（设计列：材料/供应商/单价/涨跌/单据/日期） */}
      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<HistoryPriceRow>
          rowKey={(r) => `${r.bill_no}-${r.product_id}`}
          loading={loading}
          columns={columns}
          dataSource={list}
          locale={{ emptyText: "暂无历史价格记录，完成入库后自动生成" }}
          pagination={{ current: page, pageSize, total, showTotal: (t) => `共 ${t} 条记录`, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
        />
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#8A93A8" }}>
          提示：入库时按供应商自动带出最近价格并标记涨跌；点击可查看该材料价格曲线
        </p>
      </div>
    </div>
  );
}
