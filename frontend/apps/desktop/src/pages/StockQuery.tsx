import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { App, Button, Input, Select, Space, Table, Tag, Tooltip, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, DownloadOutlined, SearchOutlined, AppstoreOutlined, InboxOutlined, ApartmentOutlined, WarningOutlined, SettingOutlined } from "@ant-design/icons";

import { baseApi, exportReportPreview, exportReportUrl, stockApi, type StockRow, type Warehouse } from "@wlt/shared";

import { ExportFormatModal, type ExportFormatSpec } from "../components/ExportFormatModal";
import { STOCK_FIELDS } from "./exportFields";

/** 物料 × 仓库/库位聚合行（树表父节点）。 */
interface MatGroup {
  key: string;
  _isGroup: true;
  product_id: number;
  product_name: string;
  material_code: string;
  barcode: string;
  spec: string;
  qty: number;
  amount: number;
  whCount: number;
  locCount: number;
  anyZero: boolean;
  children: StockRow[];
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "0");

/** 库存查询（电脑端）：物料聚合树表 —— 同一物料在多仓库/库位自动合并为一行，展开查看各仓分布（《UI设计方案.md》v2）。 */
export function StockQueryPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [params] = useSearchParams();
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [keyword, setKeyword] = useState(params.get("keyword") ?? "");
  const [warehouseId, setWarehouseId] = useState(0);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [fmtOpen, setFmtOpen] = useState(false);

  /** 导出 Excel（统一导出服务 type=stock，与库存报表共用列格式；fmt=「导出格式设置」JSON 可选）。 */
  function doExport(fmtSpec?: ExportFormatSpec) {
    const a = document.createElement("a");
    a.href = exportReportUrl({ type: "stock", keyword, ...(fmtSpec ? { fmt: JSON.stringify(fmtSpec) } : {}) });
    a.click();
  }

  /** 导出预览：后端 preview=1 返回前 10 条真实数据（源列全序）。 */
  const previewRows = () => exportReportPreview({ type: "stock" }).then((r) => r.rows);

  useEffect(() => {
    baseApi.warehouses().then(setWhs).catch(() => undefined);
  }, []);

  /** 拉取当前筛选的全量库存行（上限 1000 行，超出提示收窄条件），客户端按物料聚合。 */
  const load = useCallback(
    async (kw: string, wh: number, expandFirst = false) => {
      setLoading(true);
      setRows([]);
      try {
        const PAGE = 200;
        const all: StockRow[] = [];
        for (let p = 1; p <= 5; p++) {
          const data = await stockApi.query({ keyword: kw || undefined, warehouse_id: wh || undefined, page: p, page_size: PAGE });
          all.push(...data.list);
          if (all.length >= data.total) break;
        }
        setRows(all);
        if (expandFirst) {
          const first = all[0];
          if (first) setExpandedKeys([`g${first.product_id}`]);
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(keyword, warehouseId, true).catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  /** 物料聚合：product_id → { 元信息, 仓/库位明细 }。 */
  const groups = useMemo<MatGroup[]>(() => {
    const map = new Map<number, MatGroup & { whs: Set<number>; locs: Set<string> }>();
    for (const r of rows) {
      let g = map.get(r.product_id);
      if (!g) {
        g = {
          key: `g${r.product_id}`,
          _isGroup: true,
          product_id: r.product_id,
          product_name: r.product_name,
          material_code: r.material_code,
          barcode: r.barcode,
          spec: r.spec,
          qty: 0,
          amount: 0,
          whCount: 0,
          locCount: 0,
          anyZero: false,
          whs: new Set(),
          locs: new Set(),
          children: [],
        };
        map.set(r.product_id, g);
      }
      g.children.push(r);
      g.qty += Number(r.qty);
      g.amount += Number(r.amount) || 0;
      g.whs.add(r.warehouse_id);
      g.locs.add(`${r.warehouse_id}-${r.location_id}`);
      if (Number(r.qty) <= 0) g.anyZero = true;
    }
    const out = [...map.values()];
    for (const g of out) {
      g.whCount = g.whs.size;
      g.locCount = g.locs.size;
    }
    out.sort((a, b) => b.qty - a.qty);
    return out;
  }, [rows]);

  const multiWh = useMemo(() => groups.filter((g) => g.whCount > 1).length, [groups]);
  const zeroCount = useMemo(() => groups.filter((g) => g.anyZero).length, [groups]);
  const totalQty = useMemo(() => groups.reduce((s, g) => s + g.qty, 0), [groups]);

  const columns = useMemo<ColumnsType<MatGroup | StockRow>>(
    () => [
      {
        title: "材料",
        dataIndex: "product_name",
        width: 320,
        render: (_, r) =>
          "_isGroup" in r && r._isGroup ? (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.product_name}</div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
                {r.material_code || "-"} {r.spec ? `· ${r.spec}` : ""} {r.barcode ? `· 条码 ${r.barcode}` : ""}
              </div>
            </div>
          ) : (
            <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>—</span>
          ),
      },
      {
        title: "仓库 · 库位",
        dataIndex: "warehouse_name",
        width: 260,
        render: (_, r) =>
          "_isGroup" in r && r._isGroup ? (
            <Tag style={{ marginInlineEnd: 0, borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent" }}>
              分布 {r.whCount} 个仓库 · {r.locCount} 个库位
            </Tag>
          ) : (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>{(r as StockRow).warehouse_name}</div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{(r as StockRow).location_code}</div>
            </div>
          ),
      },
      {
        title: "数量",
        dataIndex: "qty",
        width: 120,
        align: "right",
        render: (v, r) => {
          const qty = "_isGroup" in r && r._isGroup ? (r as MatGroup).qty : Number(v);
          return <span style={{ fontWeight: 700, color: qty <= 0 ? "#EF4444" : token.colorText, fontVariantNumeric: "tabular-nums" }}>{fmt(qty)}</span>;
        },
      },
      {
        title: "成本单价",
        dataIndex: "cost_price",
        width: 110,
        align: "right",
        render: (v, r) => ("_isGroup" in r && r._isGroup ? <span style={{ color: token.colorTextTertiary }}>—</span> : <span style={{ color: token.colorTextSecondary }}>¥ {v || "0.00"}</span>),
      },
      {
        title: "金额",
        dataIndex: "amount",
        width: 130,
        align: "right",
        render: (v, r) => {
          const amt = "_isGroup" in r && r._isGroup ? `¥ ${fmt((r as MatGroup).amount)}` : `¥ ${v || "0.00"}`;
          return <span style={{ color: token.colorTextSecondary, fontVariantNumeric: "tabular-nums" }}>{amt}</span>;
        },
      },
      {
        title: "状态",
        width: 130,
        render: (_, r) =>
          "_isGroup" in r && r._isGroup ? (
            (r as MatGroup).anyZero ? <Tag color="red" style={{ borderRadius: 999 }}>含无库存</Tag> : <Tag color="green" style={{ borderRadius: 999 }}>正常</Tag>
          ) : Number((r as StockRow).qty) <= 0 ? <Tag color="red" style={{ borderRadius: 999 }}>无库存</Tag> : <Tag color="green" style={{ borderRadius: 999 }}>正常</Tag>,
      },
    ],
    [token]
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>库存查询</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            同一物料分布在多个仓库 / 库位时自动聚合成一行，点击行首箭头展开查看各仓分布
          </p>
        </div>
        <Space>
          <Tooltip title="点击设置导出文件的列选择、格式、列宽等选项">
            <Button icon={<SettingOutlined style={{ color: "#5B7FFF" }} />} onClick={() => setFmtOpen(true)}>导出设置</Button>
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={() => doExport()}>导出 Excel</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load(keyword, warehouseId, true)}>刷新</Button>
        </Space>
      </div>

      {/* 导出格式设置弹窗（与库存报表共用 export_fmt_stock，统一修改入口） */}
      <ExportFormatModal
        open={fmtOpen}
        onClose={() => setFmtOpen(false)}
        fields={STOCK_FIELDS}
        storageKey="export_fmt_stock"
        getPreviewRows={previewRows}
        onExport={(spec) => doExport(spec)}
      />

      {/* 筛选条 */}
      <div className="wlt-glass-sm" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Input
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="材料名称 / 物料编码 / 条码"
          allowClear
          defaultValue={keyword}
          onPressEnter={(e) => { const v = (e.target as HTMLInputElement).value; setKeyword(v); setPage(1); void load(v, warehouseId, true); }}
          style={{ width: 300 }}
        />
        <Select
          placeholder="全部仓库"
          allowClear
          style={{ width: 180 }}
          value={warehouseId || undefined}
          onChange={(v) => { setWarehouseId(v ?? 0); setPage(1); void load(keyword, v ?? 0, true); }}
          options={whs.map((w) => ({ value: w.id, label: w.name }))}
        />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
          已聚合 <b style={{ color: token.colorPrimary }}>{groups.length}</b> 个物料 · 共 {rows.length} 条仓/库位明细
        </span>
      </div>

      {/* 汇总 chips */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
        {[
          { icon: <AppstoreOutlined />, label: "材料 SKU", value: groups.length, color: "#3B5BDB", bg: "#EAEFFF" },
          { icon: <InboxOutlined />, label: "库存总件数", value: fmt(totalQty), color: "#1E2433", bg: "#F6F8FE" },
          { icon: <ApartmentOutlined />, label: "多仓分布物料", value: multiWh, color: "#B45309", bg: "#FEF4E2" },
          { icon: <WarningOutlined />, label: "含无库存物料", value: zeroCount, color: "#B91C1C", bg: "#FDEBEC" },
        ].map((c) => (
          <div key={c.label} className="wlt-glass-sm" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 12, background: c.bg, color: c.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{c.icon}</span>
            <div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="wlt-glass" style={{ padding: 10 }}>
        <Table<MatGroup | StockRow>
          rowKey={(r) => ("_isGroup" in r && r._isGroup ? r.key : `${(r as StockRow).product_id}-${(r as StockRow).location_id}`)}
          columns={columns}
          dataSource={groups}
          loading={loading}
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys as React.Key[]),
            indentSize: 18,
          }}
          pagination={{
            current: page,
            pageSize,
            total: groups.length,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个物料`,
            onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); },
          }}
          locale={{ emptyText: "暂无库存数据" }}
        />
        <div style={{ padding: "8px 10px 2px", fontSize: 11, color: token.colorTextTertiary, borderTop: `1px solid ${token.colorBorder}`, marginTop: 4 }}>
          提示：库存按「物料 × 仓库 × 库位」实时汇总；行末展开查看各仓库/库位明细与成本单价
        </div>
      </div>
    </div>
  );
}
