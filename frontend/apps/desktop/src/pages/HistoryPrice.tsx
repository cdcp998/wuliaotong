import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Select, Space, theme } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, purchaseApi, type HistoryPriceRow, type Supplier } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 历史价格管理（库存管理）：查询物料历史采购价及对应供应商（谁供的货），并按「材料×供应商」对比上一笔采购价展示涨跌胶囊（红涨/绿跌/持平，设计页21）。 */
export function HistoryPricePage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [list, setList] = useState<HistoryPriceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [supplierId, setSupplierId] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
      const data = await purchaseApi.historyPrice({ keyword, supplierId, page, pageSize });
      setList(data.list);
      setTotal(data.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, supplierId, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.suppliers().then((d) => setSuppliers(d.list)).catch(() => undefined);
  }, []);

  /** 涨跌对比（设计页21）：列表按入库日期倒序，同一「材料×供应商」相邻两笔的价格差。
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
    if (!c) return <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>首笔 —</span>;
    const meta = c.dir === "up" ? { text: "涨", fg: "#DC2626", bg: "#FDEBEC", glyph: "▲" } : c.dir === "down" ? { text: "跌", fg: "#15803D", bg: "#E8F9EF", glyph: "▼" } : { text: "持平", fg: "#5B6478", bg: "#EFF3FC", glyph: "•" };
    return (
      <span className="wlt-pill" style={{ background: meta.bg, color: meta.fg, gap: 3 }}>
        {meta.glyph} {meta.text} {c.pct ? `${c.pct.toFixed(1)}%` : ""}
      </span>
    );
  }

  const columns: ColumnsType<HistoryPriceRow> = [
    { title: "入库日期", dataIndex: "bill_date", width: 110, render: (v: string) => v?.slice(0, 10) },
    { title: "入库单号", dataIndex: "bill_no", width: 150 },
    { title: "物料编码", dataIndex: "material_code", width: 140, render: (v: string) => v || "-" },
    { title: "材料名称", dataIndex: "product_name", width: 160 },
    { title: "规格型号", dataIndex: "spec", width: 130, render: (v: string) => v || "-" },
    { title: "单位", dataIndex: "unit_name", width: 70 },
    { title: "单价", dataIndex: "price", width: 90, align: "right" as const },
    {
      title: "涨跌",
      key: "change",
      width: 110,
      render: (_, r) => renderChange(r),
    },
    { title: "数量", dataIndex: "qty", width: 90, align: "right" as const },
    { title: "金额", dataIndex: "amount", width: 100, align: "right" as const },
    { title: "供应商（谁供的货）", dataIndex: "supplier_name", width: 200, render: (v: string) => v || "-" },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>历史价格管理</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="材料名称 / 编码 / 物料编码 / 规格"
          allowClear
          style={{ width: 260 }}
          onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
        />
        <Select
          style={{ width: 200 }}
          placeholder="供应商（谁供的货）"
          allowClear
          showSearch
          optionFilterProp="label"
          options={suppliers.map((s) => ({ label: s.name, value: s.id }))}
          value={supplierId || undefined}
          onChange={(v) => { setSupplierId(v ?? 0); setPage(1); }}
        />
        <Button onClick={() => { setKeyword(""); setSupplierId(0); setPage(1); }}>重置</Button>
        <span style={{ color: "#5B6478", fontSize: 12 }}>共 {total} 条历史采购记录（按入库日期倒序）</span>
      </Space>
      <DataTable
        rowKey={(r) => `${r.bill_no}-${r.product_id}`}
        loading={loading}
        columns={columns}
        dataSource={list}
        locale={{ emptyText: "暂无历史价格记录，完成入库后自动生成" }}
        pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
       rowSelection onBatchDelete={async () => { message.info("该列表为只读数据，不支持删除"); }} />
    </div>
  );
}
