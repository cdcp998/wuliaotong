import { useEffect, useMemo, useState } from "react";
import { Button, Input, List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { BarcodeScanner, CameraIcon, stockApi, type StockRow } from "@wlt/shared";

/** 库存查询（手机端）：关键词/条码 → 商品库存位置列表（《UI设计方案.md》§5.7）。 */
export function StockQueryPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // 按材料聚合（设计页 M13：聚合卡 合计+仓库数，展开=各仓库库位行）
  const groups = useMemo(() => {
    const map = new Map<number, { product_id: number; product_name: string; spec: string; total: number; whs: Set<number>; children: StockRow[] }>();
    for (const r of list) {
      let g = map.get(r.product_id);
      if (!g) {
        g = { product_id: r.product_id, product_name: r.product_name, spec: r.spec, total: 0, whs: new Set(), children: [] };
        map.set(r.product_id, g);
      }
      g.children.push(r);
      g.total += Number(r.qty) || 0;
      g.whs.add(r.warehouse_id);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [list]);

  function toggleExpand(pid: number) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });
  }

  useEffect(() => {
    void search("");
  }, []);

  async function search(kw: string) {
    setLoading(true);
    try {
      const d = await stockApi.query({ keyword: kw || undefined });
      setList(d.list);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wlt-page-enter" style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar onBack={() => navigate("/")}>库存查询</NavBar>
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Input
            placeholder="材料名称 / 物料编码 / 条码"
            value={keyword}
            onChange={setKeyword}
            onEnterPress={() => void search(keyword)}
            style={{
              flex: 1,
              height: 42,
              background: "#fff",
              borderRadius: 9,
              border: "1px solid #E4EAF6",
              padding: "0 12px",
              fontSize: 14,
            }}
          />
          <Button
            fill="outline"
            onClick={() => setScanOpen(true)}
            style={{ height: 42, minWidth: 88, borderRadius: 9, fontSize: 13 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <CameraIcon size={15} /> 扫码
            </span>
          </Button>
        </div>
        <div style={{ fontSize: 11.5, color: "#5B6478", marginBottom: 8, padding: "0 2px" }}>同一物料在多个仓库/库位自动聚合，点卡片展开查看各仓分布</div>
        {groups.map((g) => {
          const open = expanded.has(g.product_id);
          const zero = g.total <= 0;
          return (
            <div key={g.product_id} style={{ marginBottom: 10 }}>
              <div
                onClick={() => toggleExpand(g.product_id)}
                style={{
                  background: "#fff",
                  border: open ? "1px solid #5B7FFF" : "1px solid #E4EAF6",
                  borderRadius: 14,
                  padding: "12px 14px",
                  cursor: "pointer",
                  boxShadow: "0 6px 20px rgba(30,36,51,.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: "#EAEFFF", color: "#5B7FFF",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600,
                    }}
                  >
                    {g.product_name.slice(0, 1)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{g.product_name}</div>
                    <div style={{ fontSize: 11, color: "#5B6478", marginTop: 1 }}>
                      {g.spec || "-"} · {g.children.length} 库位
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: zero ? "#cf1322" : "#1E2433" }}>{g.total}</div>
                    <Tag color={zero ? "danger" : "success"} style={{ fontSize: 9.5, padding: "1px 5px", borderRadius: 4, marginTop: 2 }}>
                      {zero ? "无库存" : "正常"}
                    </Tag>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <Tag color="blue" fill="outline" style={{ fontSize: 10.5, borderRadius: 999, marginRight: 0 }}>
                    合计 {g.total} · {g.whs.size} 仓
                  </Tag>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#6A748A", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
                </div>
              </div>
              {open && (
                <div style={{ marginTop: 6, background: "#fff", border: "1px solid #E4EAF6", borderRadius: 12, overflow: "hidden" }}>
                  {g.children.map((r) => (
                    <div key={`${r.product_id}-${r.location_id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid #F2F5FB" }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#5B6478" }}>
                        <span style={{ color: "#1E2433", fontWeight: 500 }}>{r.warehouse_name}</span>
                        <span style={{ marginLeft: 6 }}>{r.location_code || "—"}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: Number(r.qty) <= 0 ? "#cf1322" : "#1E2433", fontVariantNumeric: "tabular-nums" }}>{r.qty}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!loading && groups.length === 0 && <List.Item>未找到库存记录</List.Item>}
      </div>
      <BarcodeScanner
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(code) => {
          setKeyword(code);
          void search(code);
        }}
      />
    </div>
  );
}
