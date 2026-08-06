import { useRef, useState } from "react";
import { Button, List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { fileApi, ocrApi, type OcrQuickResult } from "@wlt/shared";

/** 拍照快查：拍商品外包装/标签 → 识别 → 匹配系统商品 → 带入入库/出库。 */
export function OcrScanPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OcrQuickResult | null>(null);

  async function handleFile(f: File | undefined) {
    if (!f) return;
    setLoading(true);
    setResult(null);
    try {
      const up = await fileApi.upload(f, "ocr");
      const data = await ocrApi.quick(up.file_id, 2);
      setResult(data);
      if (!data.matches.length) Toast.show("未匹配到系统商品，可查看识别文本或手动搜索");
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "识别失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/")}>拍照识别</NavBar>
      <div style={{ padding: 24, textAlign: "center" }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <Button block color="primary" loading={loading} onClick={() => inputRef.current?.click()} style={{ height: 48, fontSize: 16 }}>
          {loading ? "识别中…" : "📷 拍摄商品包装/标签"}
        </Button>
        <p style={{ color: "#999", fontSize: 12, marginTop: 8 }}>识别后自动匹配系统商品，可直接带入入库/出库</p>
      </div>

      {result && (
        <>
          <List header={`识别文本（${result.lines.length} 行）`}>
            {result.lines.map((t, i) => (
              <List.Item key={i}>{t}</List.Item>
            ))}
          </List>
          <List header={`匹配商品（${result.matches.length}）`}>
            {result.matches.map((m) => (
              <List.Item
                key={m.product_id}
                description={`${m.code}${m.spec ? ` / ${m.spec}` : ""}`}
                extra={
                  <div style={{ display: "flex", gap: 6 }}>
                    <Tag color="success" fill="outline" onClick={() => navigate(`/inbound?product_id=${m.product_id}`)}>
                      入库
                    </Tag>
                    <Tag color="warning" fill="outline" onClick={() => navigate(`/outbound?product_id=${m.product_id}`)}>
                      出库
                    </Tag>
                  </div>
                }
              >
                {m.name}
              </List.Item>
            ))}
            {!result.matches.length && <List.Item>未匹配到商品，可去「入库/出库」页手动搜索添加</List.Item>}
          </List>
        </>
      )}
    </div>
  );
}
