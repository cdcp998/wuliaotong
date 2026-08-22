import { useState } from "react";
import { Button, List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { BarcodeScanner, CameraIcon, resolveByBarcode, type Product } from "@wlt/shared";

/** 扫码页（扫码 Tab / 首页扫码入口）：进入页面即直接全屏相机扫码（无中间选择页、无确认弹窗）。
 * 扫码/拍照识别到条码 → 自动查材料：命中展示结果（可直接带入入库/出库），未命中提示重新扫码。 */
export function OcrScanPage() {
  const navigate = useNavigate();
  const [scanOpen, setScanOpen] = useState(true); // 挂载即打开全屏扫码界面
  const [hit, setHit] = useState<Product | null>(null);
  const [missCode, setMissCode] = useState("");

  /** 扫码/拍照识别结果：查材料。命中/未命中都关闭扫码界面展示对应状态（autoClose=false 由本页控制关闭）。 */
  async function onScan(code: string) {
    try {
      const p = await resolveByBarcode(code);
      if (p) {
        setHit(p);
        setMissCode("");
      } else {
        setHit(null);
        setMissCode(code);
        Toast.show(`未找到条码 ${code} 对应的材料`);
      }
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "条码查询失败");
      setHit(null);
      setMissCode(code);
    } finally {
      setScanOpen(false);
    }
  }

  function rescan() {
    setHit(null);
    setMissCode("");
    setScanOpen(true); // 重新打开全屏扫码
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar onBack={() => navigate("/")}>扫码</NavBar>

      {hit && (
        <div style={{ padding: 12 }}>
          <List header="识别结果（已匹配材料）">
            <List.Item
              description={
                <div style={{ fontSize: 11.5, color: "#5B6478", marginTop: 2 }}>
                  {hit.code}
                  {hit.spec ? ` / ${hit.spec}` : ""}
                  {hit.barcode ? ` / 条码 ${hit.barcode}` : ""}
                </div>
              }
              extra={<Tag color="success">已匹配</Tag>}
            >
              {hit.name}
            </List.Item>
          </List>
          {/* 识别结果卡：命中 / 库存 / 单价（设计页 M8） */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            <div className="wlt-glass-card" style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 11, color: "#5B6478" }}>命中</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#15803D", marginTop: 2 }}>已匹配</div>
            </div>
            <div className="wlt-glass-card" style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 11, color: "#5B6478" }}>库存</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{hit.stock_qty ?? "0"}</div>
            </div>
            <div className="wlt-glass-card" style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 11, color: "#5B6478" }}>单价</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>¥ {hit.purchase_price || "0.00"}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <Button block color="primary" onClick={() => navigate(`/requisitions/new?product_id=${hit.id}`)}>
              加入领用单
            </Button>
            <Button block color="success" onClick={() => navigate(`/inbound?product_id=${hit.id}`)}>
              直接入库
            </Button>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <Button block fill="outline" color="warning" onClick={() => navigate(`/outbound?product_id=${hit.id}`)}>
              出库
            </Button>
            <Button block fill="outline" onClick={rescan}>
              重新扫码
            </Button>
          </div>
        </div>
      )}

      {!hit && missCode && (
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#4e5969" }}>未找到条码 {missCode} 对应的材料</div>
          <p style={{ color: "#5B6478", fontSize: 12, margin: "8px 0 20px" }}>
            可在「入库」页扫码后直接新增材料，或点击下方重新扫码
          </p>
          <Button block color="primary" onClick={rescan} style={{ height: 44 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <CameraIcon size={15} /> 重新扫码 / 拍照识别
            </span>
          </Button>
        </div>
      )}

      {!hit && !missCode && (
        <div style={{ padding: 40, textAlign: "center", color: "#5B6478", fontSize: 13 }}>
          正在打开相机…
        </div>
      )}

      {/* 全屏相机扫码界面：实时扫码 + 拍照/相册识别（挂载即打开，无中间选择页）
       * autoClose=false：扫码成功后等本页查材料再关闭，避免查询未完成就跳走 */}
      <BarcodeScanner
        visible={scanOpen}
        autoClose={false}
        onClose={() => navigate("/")}
        onScan={(code) => void onScan(code)}
      />
    </div>
  );
}
