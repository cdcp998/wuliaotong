import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Select, Space } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, purchaseApi, type HistoryPriceRow, type Supplier } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 历史价格管理（库存管理）：查询物料历史采购价及对应供应商（谁供的货）。 */
export function HistoryPricePage() {
  const { message } = App.useApp();
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

  const columns: ColumnsType<HistoryPriceRow> = [
    { title: "入库日期", dataIndex: "bill_date", width: 110, render: (v: string) => v?.slice(0, 10) },
    { title: "入库单号", dataIndex: "bill_no", width: 150 },
    { title: "物料编码", dataIndex: "material_code", width: 140, render: (v: string) => v || "-" },
    { title: "材料名称", dataIndex: "product_name", width: 160 },
    { title: "规格型号", dataIndex: "spec", width: 130, render: (v: string) => v || "-" },
    { title: "单位", dataIndex: "unit_name", width: 70 },
    { title: "单价", dataIndex: "price", width: 90, align: "right" as const },
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
        <span style={{ color: "#646a73", fontSize: 12 }}>共 {total} 条历史采购记录（按入库日期倒序）</span>
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
