import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { baseApi, type Warehouse } from "@wlt/shared";

/** 仓库列表（电脑端）：入口进 2D 货架图。 */
export function WarehousesPage() {
  const [list, setList] = useState<Warehouse[]>([]);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    baseApi
      .warehouses()
      .then(setList)
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"));
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <h2 style={{ margin: 0, marginBottom: 16 }}>仓库货架图</h2>
      {err && <p style={{ color: "#f5222d" }}>{err}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {list.map((w) => (
          <button
            key={w.id}
            onClick={() => navigate(`/warehouses/${w.id}/map`)}
            style={{
              padding: 20,
              textAlign: "left",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600 }}>{w.name}</div>
            <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>编码 {w.code} · 查看 2D 货架图 →</div>
          </button>
        ))}
      </div>
      {!list.length && !err && <p style={{ color: "#999", marginTop: 24 }}>暂无仓库，请先在基础资料中创建。</p>}
    </div>
  );
}
