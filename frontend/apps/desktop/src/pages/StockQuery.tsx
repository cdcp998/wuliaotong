import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { App, Button, Input, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { baseApi, exportReportUrl, stockApi, type StockRow, type Warehouse } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 库存查询（电脑端）：多条件查询 + 预警标识 + 导出（《UI设计方案.md》§4.6）。 */
export function StockQueryPage() {
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [keyword, setKeyword] = useState(params.get("keyword") ?? "");
  const [warehouseId, setWarehouseId] = useState(0);
  const [list, setList] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    baseApi.warehouses().then(setWhs).catch(() => undefined);
  }, []);

  const load = useCallback(
    async (kw: string, wh: number, pg: number) => {
      setLoading(true);
      setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
      try {
        const data = await stockApi.query({ keyword: kw || undefined, warehouse_id: wh || undefined, page: pg, page_size: pageSize });
        setList(data.list);
        setTotal(data.total);
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  useEffect(() => {
    void load(keyword, warehouseId, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const columns = useMemo<ColumnsType<StockRow>>(
    () => [
      { title: "物料编码", dataIndex: "material_code", width: 130, render: (v: string) => v || "-" },
      { title: "材料名称", dataIndex: "product_name", render: (v) => <b>{v}</b> },
      { title: "条码", dataIndex: "barcode", width: 140 },
      { title: "规格", dataIndex: "spec", width: 110 },
      { title: "仓库 / 库位", width: 180, render: (_, r) => r.location_code },
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
      <h2 style={{ margin: "0 0 16px" }}>库存查询</h2>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="材料名称 / 物料编码 / 条码"
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
            a.href = exportReportUrl({ type: "stock", keyword });
            a.click();
          }}
        >
          导出 Excel
        </Button>
      </Space>
      <DataTable
        rowKey={(r) => `${r.product_id}-${r.location_id}`}
        columns={columns}
        dataSource={list}
        loading={loading}
        size="middle"
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p: number, ps: number) => {
            if (ps !== pageSize) {
              setPage(1);
              setPageSize(ps);
            } else {
              setPage(p);
            }
          },
          showTotal: (t) => `共 ${t} 条`,
        }}
       rowSelection onBatchDelete={async () => { message.info("该列表为只读数据，不支持删除"); }} />
    </div>
  );
}
