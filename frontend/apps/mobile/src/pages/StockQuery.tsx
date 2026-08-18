import { useEffect, useState } from "react";
import { Button, Input, List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { stockApi, type StockRow } from "@wlt/shared";

import { BarcodeScanner } from "../components/BarcodeScanner";

/** 库存查询（手机端）：关键词/条码 → 商品库存位置列表（《UI设计方案.md》§5.7）。 */
export function StockQueryPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

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
    <div style={{ minHeight: "100dvh", background: "#f5f6f8" }}>
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
              border: "1px solid #e5e6eb",
              padding: "0 12px",
              fontSize: 14,
            }}
          />
          <Button
            fill="outline"
            onClick={() => setScanOpen(true)}
            style={{ height: 42, minWidth: 88, borderRadius: 9, fontSize: 13 }}
          >
            📷 扫码
          </Button>
        </div>
        <div style={{ fontSize: 11.5, color: "#646a73", marginBottom: 8, padding: "0 2px" }}>扫码 / 条码查询更快捷，也可点击「扫码」按钮调用摄像头</div>
        <List style={{ "--border-top": "0" } as React.CSSProperties}>
          {list.map((r) => (
            <List.Item
              key={`${r.product_id}-${r.location_id}`}
              prefix={
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "#e8f1fd",
                    color: "#1668dc",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {r.product_name.slice(0, 1)}
                </span>
              }
              description={
                <div style={{ fontSize: 11.5, color: "#646a73", marginTop: 2 }}>
                  {r.location_code}
                  {r.spec ? ` · ${r.spec}` : ""}
                </div>
              }
              extra={
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: Number(r.qty) <= 0 ? "#cf1322" : "#1f2329" }}>{r.qty}</div>
                  <Tag color={Number(r.qty) <= 0 ? "danger" : "success"} style={{ fontSize: 9.5, padding: "1px 5px", borderRadius: 4, marginTop: 2 }}>
                    {Number(r.qty) <= 0 ? "无库存" : "正常"}
                  </Tag>
                </div>
              }
            >
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.product_name}</span>
            </List.Item>
          ))}
          {!loading && list.length === 0 && <List.Item>未找到库存记录</List.Item>}
        </List>
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
