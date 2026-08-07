import { useMemo, useRef, useState } from "react";
import { Button, Input, Popup, Tag, Toast } from "antd-mobile";

import { baseApi, fileApi, ocrApi, resolveByBarcode, type Product } from "@wlt/shared";

import { BarcodeScanner } from "./BarcodeScanner";

/** 商品选择弹层：关键字搜索 / 拍照 / 相册 / 扫码 → 选择（手机端仓管员出入库/盘点/领用新增物料用，
 * 四个页面共用：领用申请/入库/出库/盘点）。 */
export function ProductPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (p: Product) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [imgLoading, setImgLoading] = useState(false); // 拍照/相册识别中
  const [scanOpen, setScanOpen] = useState(false);
  const camRef = useRef<HTMLInputElement>(null); // 拍照：直达后置相机
  const albRef = useRef<HTMLInputElement>(null); // 相册：不带 capture，移动端可正常选图
  const searched = useMemo(() => list.length > 0, [list]);

  /** 选中商品并关闭弹层（扫码命中/拍照命中/列表点击共用）。 */
  function finish(p: Product) {
    onPick(p);
    setList([]);
    setKeyword("");
    onClose();
  }

  async function search() {
    if (!keyword.trim()) {
      Toast.show("请输入关键字");
      return;
    }
    setLoading(true);
    try {
      const data = await baseApi.products(keyword.trim());
      setList(data.list);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  /** 扫码命中：直接选中材料并关闭；未命中：条码填入搜索框供二次搜索。 */
  async function scanBarcode(code: string) {
    try {
      const p = await resolveByBarcode(code);
      if (p) {
        finish(p);
      } else {
        setKeyword(code);
        Toast.show(`未找到条码 ${code} 对应的材料，可修改关键词搜索`);
      }
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "条码查询失败");
    }
  }

  /** 拍照/相册添加材料：上传 → 服务端识别快查（链路①条码解码+商品匹配，未命中回退 OCR 文本行）。
   * 命中商品直接选中关闭；有条码但未命中 → 条码填搜索框；无条码 → 首行识别文本作为关键词搜索展示。 */
  async function pickByImage(f: File | undefined) {
    if (!f || imgLoading) return;
    setImgLoading(true);
    try {
      const up = await fileApi.upload(f, "ocr");
      const data = await ocrApi.quick(up.file_id, 2);
      if (data.matches[0]) {
        const p = await baseApi.product(data.matches[0].product_id); // 补全单位/价格等字段
        finish(p);
        return;
      }
      if (data.barcode) {
        setKeyword(data.barcode);
        Toast.show(`未找到条码 ${data.barcode} 对应的材料，可修改关键词搜索`);
        return;
      }
      const name = (data.lines.find((t) => t.trim()) ?? "").trim();
      if (name) {
        setKeyword(name);
        setList((await baseApi.products(name)).list);
      } else {
        Toast.show("未识别到条码或文字，请手动搜索");
      }
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "识别失败");
    } finally {
      setImgLoading(false);
    }
  }

  return (
    <Popup visible={visible} onMaskClick={onClose} bodyStyle={{ height: "70vh" }}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Input
            placeholder="材料名称/物料编码/条码"
            value={keyword}
            onChange={setKeyword}
            onEnterPress={search}
            style={{ flex: 1, border: "1px solid #e5e5e5", borderRadius: 8, padding: "0 10px" }}
          />
          <Button color="primary" size="small" loading={loading} onClick={search}>
            搜索
          </Button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Button fill="outline" style={{ flex: 1 }} loading={imgLoading} onClick={() => camRef.current?.click()}>
            拍照
          </Button>
          <Button fill="outline" style={{ flex: 1 }} disabled={imgLoading} onClick={() => albRef.current?.click()}>
            相册
          </Button>
          <Button fill="outline" style={{ flex: 1 }} onClick={() => setScanOpen(true)}>
            扫码
          </Button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {!searched && !loading && <div style={{ color: "#999", textAlign: "center", paddingTop: 40 }}>输入关键字搜索商品</div>}
          {list.map((p) => (
            <div
              key={p.id}
              onClick={() => finish(p)}
              style={{
                padding: "10px 0",
                borderBottom: "1px solid #f0f0f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div>{p.name}</div>
                <div style={{ color: "#999", fontSize: 12 }}>
                  {p.code}
                  {p.spec ? ` / ${p.spec}` : ""}
                </div>
              </div>
              <Tag color="primary">{p.unit_name}</Tag>
            </div>
          ))}
        </div>
      </div>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          void pickByImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={albRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          void pickByImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <BarcodeScanner visible={scanOpen} onClose={() => setScanOpen(false)} onScan={(code) => void scanBarcode(code)} />
    </Popup>
  );
}
