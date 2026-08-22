import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, NavBar, Popup, Tag, Toast } from "antd-mobile";

import { baseApi, fileApi, ocrApi, resolveByBarcode, type Product } from "@wlt/shared";

import { BarcodeScanner } from "./BarcodeScanner";
import { useBackToClose } from "../hooks/useBackToClose";

/** 商品选择弹层：实时搜索 / 拍照 / 相册 / 扫码 → 选择（手机端仓管员出入库/盘点/领用新增物料用，
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); // 实时搜索防抖
  const searched = useMemo(() => list.length > 0, [list]);

  // 返回键（硬件/浏览器）关闭弹层
  useBackToClose(visible, onClose);

  /** 选中商品并关闭弹层（扫码命中/拍照命中/列表点击共用）。 */
  function finish(p: Product) {
    onPick(p);
    setList([]);
    setKeyword("");
    onClose();
  }

  async function doSearch(k: string) {
    if (!k) {
      setList([]);
      return;
    }
    setLoading(true);
    try {
      const data = await baseApi.products(k);
      setList(data.list);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  /** 实时搜索：输入即查（防抖 300ms，无需点「搜索」按钮）。 */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const k = keyword.trim();
    if (!k) {
      setList([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void doSearch(k);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [keyword]);

  /** 点「搜索」按钮：立即查询（取消防抖等待）。 */
  function search() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void doSearch(keyword.trim());
  }

  /** 识别命中：直接选中材料并关闭；未命中：条码填入搜索框供二次搜索（识别链路含大模型兜底命中商品）。 */
  async function scanBarcode(code: string, product?: { product_id: number; name: string }) {
    if (product) {
      // 识别链路（含大模型兜底）直接命中商品：补全详情并选中
      try {
        const p = await baseApi.product(product.product_id);
        finish(p);
      } catch (e) {
        Toast.show(e instanceof Error ? e.message : "商品查询失败");
      }
      return;
    }
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
    <Popup visible={visible} onMaskClick={onClose} bodyStyle={{ height: "70vh", display: "flex", flexDirection: "column" }}>
      {/* 标题栏：明确弹层用途，右侧关闭按钮 */}
      <NavBar
        onBack={onClose}
        right={
          <span onClick={onClose} style={{ fontSize: 14, color: "#1668dc", padding: "0 12px" }}>
            关闭
          </span>
        }
        style={{ borderBottom: "1px solid #f0f1f3", background: "#fff", flex: "none" }}
      >
        添加材料
      </NavBar>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
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
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Button fill="outline" style={{ flex: 1 }} loading={imgLoading} onClick={() => camRef.current?.click()}>
            拍照
          </Button>
          <Button fill="outline" style={{ flex: 1 }} disabled={imgLoading} onClick={() => albRef.current?.click()}>
            相册
          </Button>
          <Button fill="outline" style={{ flex: 1 }} onClick={() => setScanOpen(true)}>
            识别
          </Button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {!searched && !loading && (
            <div style={{ color: "#646a73", textAlign: "center", paddingTop: 48, fontSize: 13, lineHeight: 1.8 }}>
              输入材料名称 / 编码 / 条码搜索，
              <br />
              或使用下方「拍照 / 相册 / 扫码」直接添加
            </div>
          )}
          {searched && (
            <div style={{ fontSize: 12, color: "#646a73", padding: "6px 2px" }}>搜索结果（{list.length} 个），点击选中</div>
          )}
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
                <div style={{ color: "#646a73", fontSize: 12 }}>
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
      <BarcodeScanner visible={scanOpen} onClose={() => setScanOpen(false)} onScan={(code, product) => void scanBarcode(code, product)} />
    </Popup>
  );
}
