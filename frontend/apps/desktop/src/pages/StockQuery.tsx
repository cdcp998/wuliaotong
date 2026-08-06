import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Input, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, stockApi, type StockRow, type Warehouse } from "@wlt/shared";

/** 库存查询（电脑端）：多条件查询 + 预警标识 + 导出（《UI设计方案.md》§4.6）。 */
export function StockQueryPage() {
  const [params] = useSearchParams();
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [keyword, setKeyword] = useState(params.get("keyword") ?? "");
  const [warehouseId, setWarehouseId] = useState(0);
  const [list, setList] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    baseApi.warehouses().then(setWhs).catch(() => undefined);
  }, []);

  const load = useCallback(
    async (kw: string, wh: number, pg: number) => {
      setLoading(true);
      try {
        const data = await stockApi.query({ keyword: kw || undefined, warehouse_id: wh || undefined, page: pg });
        setList(data.list);
        setTotal(data.total);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(keyword, warehouseId, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const columns = useMemo<ColumnsType<StockRow>>(
    () => [
      { title: "商品编码", dataIndex: "code", width: 110 },
      { title: "商品名称", dataIndex: "product_name", render: (v) => <b>{v}</b> },
      { title: "条码", dataIndex: "barcode", width: 140 },
      { title: "规格", dataIndex: "spec", width: 110 },
      { title: "仓库 / 库位", width: 180, render: (_, r) => `${r.warehouse_name} / ${r.location_code}` },
      { title: "数量", dataIndex: "qty", width: 100, align: "right" as const, render: (v: string) => <span style={{ color: Number(v) <= 0 ? "#cf1322" : undefined, fontWeight: 600 }}>{v}</span> },
      { title: "成本单价", dataIndex: "cost_price", width: 100, align: "right" as const, render: (v: string) => `¥ ${v}` },
      { title: "金额", dataIndex: "amount", width: 120, align: "right" as const, render: (v: string) => `¥ ${v}` },
      {
        title: "状态",
        width: 90,
        render: (_, r) =>
          Number(r.qty) <= 0 ? <Tag color="red">无库存</Tag> : <Tag color="green">正常</Tag>,
      },
    ],
    []
  );

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: 0, marginBottom: 16 }}>库存查询</h2>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="商品名称 / 编码 / 条码"
          allowClear
          defaultValue={keyword}
          onSearch={(v) => {
            setKeyword(v);
            setPage(1);
            void load(v, warehouseId, 1);
          }}
          style={{ width: 280 }}
        />
        <Select
          placeholder="全部仓库"
          allowClear
          style={{ width: 160 }}
          value={warehouseId || undefined}
          onChange={(v) => {
            setWarehouseId(v ?? 0);
            setPage(1);
            void load(keyword, v ?? 0, 1);
          }}
          options={whs.map((w) => ({ value: w.id, label: w.name }))}
        />
        <Button
          onClick={() => {
            const a = document.createElement("a");
            a.href = `/api/v1/reports/export?type=stock&keyword=${encodeURIComponent(keyword)}`;
            a.click();
          }}
        >
          导出 Excel
        </Button>
      </Space>
      <Table
        rowKey={(r) => `${r.product_id}-${r.location_id}`}
        columns={columns}
        dataSource={list}
        loading={loading}
        size="middle"
        pagination={{
          current: page,
          pageSize: 20,
          total,
          onChange: setPage,
          showTotal: (t) => `共 ${t} 条`,
        }}
      />
    </div>
  );
}
