import { useState } from "react";
import { Button, List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { resolveByBarcode, type Product } from "@wlt/shared";

import { BarcodeScanner } from "../components/BarcodeScanner";

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
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/")}>扫码</NavBar>

      {hit && (
        <div style={{ padding: 12 }}>
          <List header="识别结果（已匹配材料）">
            <List.Item
              description={
                <div style={{ fontSize: 11.5, color: "#86909c", marginTop: 2 }}>
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
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <Button block color="primary" onClick={() => navigate(`/inbound?product_id=${hit.id}`)}>
              入库
            </Button>
            <Button block color="warning" onClick={() => navigate(`/outbound?product_id=${hit.id}`)}>
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
          <p style={{ color: "#86909c", fontSize: 12, margin: "8px 0 20px" }}>
            可在「入库」页扫码后直接新增材料，或点击下方重新扫码
          </p>
          <Button block color="primary" onClick={rescan} style={{ height: 44 }}>
            📷 重新扫码 / 拍照识别
          </Button>
        </div>
      )}

      {!hit && !missCode && (
        <div style={{ padding: 40, textAlign: "center", color: "#86909c", fontSize: 13 }}>
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
