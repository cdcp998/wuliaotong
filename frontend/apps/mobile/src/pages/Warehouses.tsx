import { useEffect, useMemo, useState } from "react";
import { NavBar } from "antd-mobile";
import { useNavigate } from "react-router";

import { baseApi, reportApi, type LocationStock, type Shelf, type Warehouse } from "@wlt/shared";

/** 仓库与货架（手机端只读）——OP 规格（设计页 M14）重构：
 * 只读提示条（r14 品牌浅底）+ 仓库卡列表（名称/code·N货架 + 「库位 n」胶囊，点击选中）
 * + 选中仓库的分层货架视图（每层一张白卡：「第 N 层」+ 库位格横排滚动：
 * 有货格=品牌浅底 库位码蓝字+数量灰字，空位=白底「空」）+ 页脚说明。
 * 新增/编辑仓库、货架、库位请到电脑端操作（手机端仅查看）。 */
export function WarehousesPage() {
  const navigate = useNavigate();
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [selWhId, setSelWhId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [stocks, setStocks] = useState<LocationStock[]>([]);

  useEffect(() => {
    baseApi
      .warehouses()
      .then((ws) => setWhs(ws.filter((w) => w.status === 1)))
      .catch(() => setWhs([]));
  }, []);

  async function openWh(w: Warehouse) {
    if (selWhId === w.id) return;
    setSelWhId(w.id);
    setLoading(true);
    setShelves([]);
    setStocks([]);
    try {
      const [sh, st] = await Promise.all([baseApi.shelves(w.id), reportApi.locationSummary(w.id)]);
      setShelves(sh);
      setStocks(st);
    } catch {
      /* 加载失败保持空态 */
    } finally {
      setLoading(false);
    }
  }

  // 按货架 × 层分组库位库存：Map<shelf_id, Map<layer_no, LocationStock[]>>
  const grouped = useMemo(() => {
    const byShelf = new Map<number, Map<number, LocationStock[]>>();
    for (const s of stocks) {
      let layers = byShelf.get(s.shelf_id);
      if (!layers) {
        layers = new Map();
        byShelf.set(s.shelf_id, layers);
      }
      const arr = layers.get(s.layer_no) ?? [];
      arr.push(s);
      layers.set(s.layer_no, arr);
    }
    return byShelf;
  }, [stocks]);

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB", paddingBottom: 24 }}>
      <NavBar onBack={() => navigate("/")}>仓库与货架</NavBar>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* 只读提示条（OP Info r14 bg#EAEFFF） */}
        <div style={{ borderRadius: 14, background: "#EAEFFF", padding: "10px 12px", fontSize: 11.5, fontWeight: 500, color: "#3B5BDB" }}>
          只读视图 · 库位管理与新增请在电脑端操作
        </div>

        {/* 仓库卡（OP WH r16 白卡 p12 gap6；选中名称高亮深蓝） */}
        {whs.map((w) => {
          const active = selWhId === w.id;
          return (
            <div
              key={w.id}
              onClick={() => void openWh(w)}
              style={{
                background: "#fff",
                border: active ? "1px solid #D9E3FF" : "1px solid #E4EAF6",
                borderRadius: 16,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? "#3B5BDB" : "#1E2433" }}>{w.name}</div>
                  <div style={{ fontSize: 10.5, color: "#8A93A8", marginTop: 1 }}>
                    {w.code} · {w.shelf_count ?? 0} 货架{w.address ? ` · ${w.address}` : ""}
                  </div>
                </div>
                <span className="wlt-pill wlt-pill--blue" style={{ fontSize: 12, lineHeight: "20px", padding: "2px 10px" }}>
                  库位 {active ? stocks.length : w.location_count ?? 0}
                </span>
              </div>

              {/* 分层货架视图（选中仓库后内联展开） */}
              {active && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                  {loading && <div style={{ fontSize: 12, color: "#8A93A8", textAlign: "center", padding: 16 }}>加载中…</div>}
                  {!loading && shelves.length === 0 && (
                    <div style={{ fontSize: 12, color: "#8A93A8", textAlign: "center", padding: 16 }}>该仓库暂无货架</div>
                  )}
                  {!loading &&
                    shelves.map((sh) => {
                      const layersMap = grouped.get(sh.id);
                      const layerNos = [...(layersMap?.keys() ?? [])].sort((a, b) => b - a); // 顶→底
                      // 无库位的层也要展示：以货架维度推导完整层号（顶层在前）
                      const allLayers = new Set(layerNos);
                      for (let i = 1; i <= (sh.layers ?? Math.max(1, ...layerNos, 1)); i++) allLayers.add(i);
                      const ordered = [...allLayers].sort((a, b) => b - a);
                      return (
                        <div key={sh.id}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#1E2433", margin: "6px 0" }}>
                            {sh.code || sh.name} · 分层视图<span style={{ fontWeight: 400, color: "#8A93A8" }}>（只读）</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {ordered.map((layerNo) => {
                              const cells = layersMap?.get(layerNo) ?? [];
                              const cellMap = new Map(cells.map((c) => [`${c.row_no}-${c.col_no}`, c]));
                              // 完整网格（行×列，缺省 1×1）：有货格显示 库位码+数量，空位补「空」
                              const maxRow = Math.max(sh.rows ?? 1, ...cells.map((c) => c.row_no), 1);
                              const maxCol = Math.max(sh.cols ?? 1, ...cells.map((c) => c.col_no), 1);
                              const slots: (LocationStock | null)[] = [];
                              for (let r = 1; r <= maxRow; r++) {
                                for (let c = 1; c <= maxCol; c++) slots.push(cellMap.get(`${r}-${c}`) ?? null);
                              }
                              return (
                                <div key={layerNo} style={{ background: "#fff", border: "1px solid #E4EAF6", borderRadius: 12, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: "#8A93A8" }}>第 {layerNo} 层</div>
                                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                                    {slots.map((cell, i) =>
                                      cell ? (() => {
                                        const qty = cell.items.reduce((sum, it) => sum + Number(it.qty || 0), 0);
                                        const low = cell.items.some((it) => it.alert === "low");
                                        return (
                                          <div
                                            key={cell.location_id}
                                            style={{
                                              width: 52,
                                              flexShrink: 0,
                                              borderRadius: 8,
                                              background: "#EAEFFF",
                                              padding: 5,
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: 1,
                                            }}
                                          >
                                            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#3B5BDB", whiteSpace: "nowrap" }}>
                                              R{cell.row_no}C{cell.col_no}
                                            </span>
                                            <span style={{ fontSize: 9, color: low ? "#DC2626" : "#8A93A8" }}>{qty}</span>
                                          </div>
                                        );
                                      })() : (
                                        <div
                                          key={`empty-${i}`}
                                          style={{
                                            width: 52,
                                            flexShrink: 0,
                                            borderRadius: 8,
                                            background: "#fff",
                                            border: "1px dashed #CBD6EC",
                                            padding: 5,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 1,
                                          }}
                                        >
                                          <span style={{ fontSize: 9, color: "#8A93A8" }}>{"\u00A0"}</span>
                                          <span style={{ fontSize: 9, color: "#8A93A8" }}>空</span>
                                        </div>
                                      ),
                                    )}
                                    {maxRow * maxCol === 0 && <span style={{ fontSize: 10.5, color: "#8A93A8" }}>本层暂无库位</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
        {whs.length === 0 && (
          <div style={{ textAlign: "center", color: "#8A93A8", fontSize: 13, padding: "48px 0" }}>暂无仓库</div>
        )}

        <div style={{ fontSize: 10.5, color: "#8A93A8", textAlign: "center", lineHeight: 1.7 }}>
          手机端仅查看；新增货架/库位、调整库存请使用电脑端
        </div>
      </div>
    </div>
  );
}
