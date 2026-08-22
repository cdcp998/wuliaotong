import { useEffect, useMemo, useState } from "react";
import { List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { baseApi, reportApi, type LocationStock, type Shelf, type Warehouse } from "@wlt/shared";

const ALERT: Record<string, { text: string; color: "danger" | "warning" | "success" }> = {
  low: { text: "偏低", color: "danger" },
  high: { text: "偏高", color: "warning" },
  normal: { text: "正常", color: "success" },
};

/** 仓库与货架（手机端只读）：仓库列表 → 货架 → 库位库存（材料/数量/预警）。 */
export function WarehousesPage() {
  const navigate = useNavigate();
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selWh, setSelWh] = useState<Warehouse | null>(null);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [stocks, setStocks] = useState<LocationStock[]>([]);

  useEffect(() => {
    baseApi
      .warehouses()
      .then((ws) => setWhs(ws.filter((w) => w.status === 1)))
      .catch(() => Toast.show("加载失败"));
  }, []);

  async function openWh(w: Warehouse) {
    setSelWh(w);
    setLoading(true);
    try {
      const [sh, st] = await Promise.all([baseApi.shelves(w.id), reportApi.locationSummary(w.id)]);
      setShelves(sh);
      setStocks(st);
    } catch {
      Toast.show("加载失败");
    } finally {
      setLoading(false);
    }
  }

  // 按货架分组库位库存
  const byShelf = useMemo(() => {
    const m = new Map<number, LocationStock[]>();
    for (const s of stocks) {
      const arr = m.get(s.shelf_id) ?? [];
      arr.push(s);
      m.set(s.shelf_id, arr);
    }
    return m;
  }, [stocks]);

  if (selWh) {
    return (
      <div style={{ minHeight: "100dvh", background: "#f5f6f8" }}>
        <NavBar onBack={() => setSelWh(null)}>{selWh.name}</NavBar>
        <div style={{ padding: 12 }}>
          <div style={{ fontSize: 12, color: "#646a73", marginBottom: 8 }}>
            {selWh.code} · {shelves.length} 个货架 · {stocks.length} 个有货库位（手机端只读，编辑请用电脑端）
          </div>
          {loading && <List.Item>加载中…</List.Item>}
          {!loading && shelves.length === 0 && <List.Item>该仓库暂无货架</List.Item>}
          {!loading &&
            shelves.map((sh) => {
              const locs = byShelf.get(sh.id) ?? [];
              return (
                <div key={sh.id} style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, marginBottom: 10, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid #f5f6f8", fontSize: 13.5, fontWeight: 600 }}>
                    {sh.name || sh.code} <span style={{ color: "#c9cdd4", fontSize: 11, fontWeight: 400 }}>{sh.code}</span>
                    {locs.length === 0 && <span style={{ color: "#c9cdd4", fontSize: 11, fontWeight: 400, marginLeft: 8 }}>无库存</span>}
                  </div>
                  {locs.map((loc) => (
                    <div key={loc.location_id} style={{ padding: "10px 14px", borderBottom: "1px solid #f5f6f8" }}>
                      <div style={{ fontSize: 12, color: "#1668dc", fontWeight: 500 }}>{loc.location_code}</div>
                      {loc.items.length === 0 && <div style={{ fontSize: 11.5, color: "#c9cdd4", marginTop: 2 }}>空库位</div>}
                      {loc.items.map((it, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, fontSize: 12.5 }}>
                          <span style={{ flex: 1, minWidth: 0 }}>{it.name}</span>
                          <span style={{ fontWeight: 600 }}>{it.qty}</span>
                          <Tag color={ALERT[it.alert].color} style={{ fontSize: 10, padding: "0 5px", lineHeight: 1.5 }}>
                            {ALERT[it.alert].text}
                          </Tag>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/")}>仓库与货架</NavBar>
      {/* 手机端只读提示：编辑/新增在电脑端 */}
      <div style={{ background: "#e8f1fd", borderBottom: "1px solid #d6e4ff", color: "#1668dc", fontSize: 12, lineHeight: 1.6, padding: "8px 14px" }}>
        手机端仅可查看库存；新增/编辑仓库、货架、库位请到电脑端「仓库与货架」操作。
      </div>
      <List style={{ "--border-top": "0" } as React.CSSProperties}>
        {whs.map((w) => (
          <List.Item
            key={w.id}
            onClick={() => void openWh(w)}
            description={
              <div style={{ fontSize: 11.5, color: "#646a73", marginTop: 3 }}>
                {w.code}
                {w.address ? ` · ${w.address}` : ""}
              </div>
            }
            extra={
              <span style={{ fontSize: 11, color: "#c9cdd4" }}>
                货架 {w.shelf_count ?? 0} · 库位 {w.location_count ?? 0} · 材料 {w.product_kind_count ?? 0}
              </span>
            }
          >
            <span style={{ fontSize: 14, fontWeight: 500 }}>{w.name}</span>
          </List.Item>
        ))}
        {whs.length === 0 && <List.Item>暂无仓库</List.Item>}
      </List>
    </div>
  );
}
