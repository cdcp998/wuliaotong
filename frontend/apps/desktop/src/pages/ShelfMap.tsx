import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button, Modal, Select, Tag } from "antd";

import { baseApi, reportApi, type LocationStock, type Shelf } from "@wlt/shared";

const ALERT_COLOR: Record<string, string> = {
  low: "#f5222d",
  high: "#F59E0B",
  normal: "#22C55E",
};
const ALERT_TEXT: Record<string, string> = {
  low: "低于下限",
  high: "高于上限",
  normal: "正常",
};

function locColor(items: LocationStock["items"]): string {
  if (!items.length) return "#f5f5f5";
  if (items.some((i) => i.alert === "low")) return "#fff1f0";
  if (items.some((i) => i.alert === "high")) return "#fffbe6";
  return "#f6ffed";
}

function locBorder(items: LocationStock["items"]): string {
  if (!items.length) return "#d9d9d9";
  if (items.some((i) => i.alert === "low")) return ALERT_COLOR.low;
  if (items.some((i) => i.alert === "high")) return ALERT_COLOR.high;
  return ALERT_COLOR.normal;
}

/** 2D 货架图（电脑端）：仓库 → 货架 → 层 → 库位格；颜色标识预警；点击格子看商品明细。 */
export function ShelfMapPage() {
  const { id } = useParams();
  const whId = Number(id);
  const navigate = useNavigate();
  const [whName, setWhName] = useState("");
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelfId, setShelfId] = useState<number>(0);
  const [rows, setRows] = useState<LocationStock[]>([]);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<LocationStock | null>(null);

  const load = useCallback(async () => {
    try {
      const whs = await baseApi.warehouses();
      setWhName(whs.find((w) => w.id === whId)?.name ?? `仓库 #${whId}`);
      const shs = await baseApi.shelves(whId);
      setShelves(shs);
      const data = await reportApi.locationSummary(whId, shelfId || undefined);
      setRows(data);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  }, [whId, shelfId]);

  useEffect(() => {
    void load();
  }, [load]);

  const layers = useMemo(() => {
    const map = new Map<number, LocationStock[]>();
    for (const r of rows) {
      const arr = map.get(r.layer_no) ?? [];
      arr.push(r);
      map.set(r.layer_no, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>
          <a onClick={() => navigate("/warehouses")} style={{ color: "#5B7FFF", cursor: "pointer" }}>仓库货架图</a>
          {" / "}{whName}
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Select
            style={{ width: 200 }}
            placeholder="全部货架"
            allowClear
            value={shelfId || undefined}
            options={shelves.map((s) => ({ label: `${s.code}${s.name ? ` ${s.name}` : ""}`, value: s.id }))}
            onChange={(v) => setShelfId(v ?? 0)}
          />
          <Button onClick={() => void load()}>刷新</Button>
        </div>
      </div>
      {err && <p style={{ color: "#f5222d" }}>{err}</p>}

      <div style={{ marginTop: 16, display: "flex", gap: 16, fontSize: 12, color: "#666" }}>
        <span><span style={{ display: "inline-block", width: 12, height: 12, background: "#f6ffed", border: `1px solid ${ALERT_COLOR.normal}`, borderRadius: 3, marginRight: 4 }} />正常</span>
        <span><span style={{ display: "inline-block", width: 12, height: 12, background: "#fff1f0", border: `1px solid ${ALERT_COLOR.low}`, borderRadius: 3, marginRight: 4 }} />低于下限</span>
        <span><span style={{ display: "inline-block", width: 12, height: 12, background: "#fffbe6", border: `1px solid ${ALERT_COLOR.high}`, borderRadius: 3, marginRight: 4 }} />高于上限</span>
        <span><span style={{ display: "inline-block", width: 12, height: 12, background: "#f5f5f5", border: "1px solid #d9d9d9", borderRadius: 3, marginRight: 4 }} />空库位</span>
      </div>

      {layers.map(([layer, locs]) => (
        <div key={layer} style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 8 }}>第 {layer} 层</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {locs.map((loc) => (
              <button
                key={loc.location_id}
                onClick={() => setDetail(loc)}
                style={{
                  width: 170,
                  minHeight: 90,
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${locBorder(loc.items)}`,
                  background: locColor(loc.items),
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{loc.location_code}</div>
                {loc.items.length === 0 && <div style={{ fontSize: 12, color: "#bbb", marginTop: 6 }}>空库位</div>}
                {loc.items.slice(0, 2).map((it) => (
                  <div key={it.product_id} style={{ fontSize: 12, marginTop: 4, color: "#333" }}>
                    {it.name} × {it.qty}
                    {it.alert !== "normal" && <Tag style={{ marginLeft: 4, fontSize: 10 }} color={ALERT_COLOR[it.alert]}>{ALERT_TEXT[it.alert]}</Tag>}
                  </div>
                ))}
                {loc.items.length > 2 && <div style={{ fontSize: 11, color: "#5B6478", marginTop: 2 }}>…共 {loc.items.length} 种材料</div>}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!rows.length && !err && <p style={{ color: "#5B6478", marginTop: 24 }}>该仓库暂无库位。</p>}

      <Modal title={`库位 ${detail?.location_code ?? ""} 明细`} open={Boolean(detail)} onCancel={() => setDetail(null)} footer={null}>
        {detail && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={thStyle}>材料名称</th><th style={thStyle}>数量</th><th style={thStyle}>状态</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.product_id}>
                  <td style={tdStyle}>{it.name} <span style={{ color: "#5B6478" }}>{it.spec}</span></td>
                  <td style={tdStyle}>{it.code}</td>
                  <td style={tdStyle}>{it.qty}</td>
                  <td style={tdStyle}><Tag color={ALERT_COLOR[it.alert]}>{ALERT_TEXT[it.alert]}</Tag></td>
                </tr>
              ))}
              {!detail.items.length && <tr><td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#5B6478" }}>空库位</td></tr>}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #f0f0f0" };
const tdStyle: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #fafafa" };
