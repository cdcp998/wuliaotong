import { useEffect, useRef, useState } from "react";
import { ActionSheet, Button, DatePicker, Dialog, DotLoading, Input, List, NavBar, Popup, Tag, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router";
import { baseApi, fileApi, ocrApi, purchaseIn, resolveByBarcode, type Location, type OcrDeliveryItem, type OcrTask, type Product, type Supplier, type Unit, type Warehouse } from "@wlt/shared";
import { CameraAlbum } from "../components/CameraAlbum";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { ProductPicker } from "../components/ProductPicker";

interface Row {
  product: Product;
  location?: Location;
  qty: string;
  price: string;
  barcode: string;
}

/** 手机端入库：表头（标题行：仓库/供应商/日期/备注）+ 明细；条码可选，扫码枪/手输/拍照识别，未匹配可当场新增材料。 */
export function InboundPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<number>(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<number>(0);
  const [billDate, setBillDate] = useState<Date>(new Date());
  const [remark, setRemark] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locPicker, setLocPicker] = useState<{ rowIndex: number; locations: Location[]; open: boolean }>({ rowIndex: -1, locations: [], open: false });
  const [supPicker, setSupPicker] = useState(false);
  const [datePicker, setDatePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scanRow, setScanRow] = useState<number>(-1);
  const [scannerOpen, setScannerOpen] = useState(false); // 行条码实时扫码弹层（BarcodeScanner）
  // 无材料新增：条码未匹配 → 确认后弹表单，用识别数据建材料并带入明细行
  const [newMaterial, setNewMaterial] = useState<{ open: boolean; rowIndex: number; barcode: string; name: string; spec: string; unitId: number }>({ open: false, rowIndex: -1, barcode: "", name: "", spec: "", unitId: 0 });
  // 送货单识别（拍照/相册 → 视觉识别异步任务 → 轮询 → 确认带入明细）
  const [ocrLoading, setOcrLoading] = useState(false); // 上传/识别/确认中
  const [ocrTask, setOcrTask] = useState<OcrTask | null>(null);
  const [ocrConfirm, setOcrConfirm] = useState<{ supplierName: string; billNo: string; items: OcrDeliveryItem[] } | null>(null);
  const ocrTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const ocrCamRef = useRef<HTMLInputElement>(null);
  const ocrAlbRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    baseApi.warehouses().then((ws) => {
      setWarehouses(ws.filter((w) => w.status === 1));
      if (ws.length) setWarehouseId(ws[0].id);
    });
    baseApi.suppliers(1).then((d) => setSuppliers(d.list)).catch(() => undefined);
    baseApi.units().then(setUnits).catch(() => undefined);
    const pid = Number(params.get("product_id"));
    if (pid) {
      baseApi.product(pid).then((p) => setRows((rs) => (rs.some((r) => r.product.id === p.id) ? rs : [...rs, { product: p, qty: "1", price: "", barcode: "" }]))).catch(() => Toast.show("材料不存在"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载时清理识别轮询
  useEffect(() => () => { if (ocrTimerRef.current) clearInterval(ocrTimerRef.current); }, []);

  async function pickLocation(rowIndex: number) {
    if (!warehouseId) return;
    const locs = await baseApi.locations(warehouseId);
    setLocPicker({ rowIndex, locations: locs, open: true });
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow(p: Product) {
    if (rows.some((r) => r.product.id === p.id)) return Toast.show("材料已在明细中");
    setRows((rs) => [...rs, { product: p, qty: "1", price: "", barcode: "" }]);
  }

  /** 条码/图片识别：识别结果先回填条码框（可见可改）；命中材料直接带入明细行；
 * 未命中：扫码路径仅提示不回填「新增材料」弹窗（fromScan=true），手动输入回车路径仍弹确认（保留新增能力）；
 * matched：识别链路（含大模型兜底）直接命中的商品 → 补全详情带入。 */
  async function scanBarcode(i: number, value: string, fromScan = false, matched?: { product_id: number; name: string } | null) {
    const b = value.trim();
    if (!b && !matched) return;
    updateRow(i, { barcode: b }); // 识别结果自动填入条码输入框，无需手动输入
    try {
      if (matched) {
        // 大模型/视觉识别命中商品：补全详情直接带入
        const p = await baseApi.product(matched.product_id);
        updateRow(i, { product: p });
        Toast.show(`识别命中：${p.name}`);
        return;
      }
      const p = await resolveByBarcode(b);
      if (p) {
        updateRow(i, { product: p });
        Toast.show(`条码匹配：${p.name}`);
      } else if (fromScan) {
        // 扫码成功但未匹配：不弹「新增材料」打断扫码节奏，条码已填入条码框
        Toast.show(`未找到条码 ${b} 对应的材料，条码已填入，可手动添加`);
      } else {
        const ok = await Dialog.confirm({ content: `未找到条码 ${b} 对应的材料，是否新增该材料？`, confirmText: "新增材料", cancelText: "取消" });
        if (ok) setNewMaterial({ open: true, rowIndex: i, barcode: b, name: "", spec: "", unitId: units[0]?.id ?? 0 });
      }
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "条码查询失败");
    }
  }


  /** 新增材料弹窗：拍照/相册识别材料名称（OCR 快查，命中取系统名，否则取首行识别文本）。 */
  async function ocrNewMaterialName(f: File | undefined) {
    if (!f) return;
    try {
      const up = await fileApi.upload(f, "ocr");
      const data = await ocrApi.quick(up.file_id, 2);
      const name = (data.matches[0]?.name ?? data.lines.find((t) => t.trim()) ?? "").trim();
      if (name) {
        setNewMaterial((s) => ({ ...s, name }));
        Toast.show(`已识别名称：${name}`);
      } else {
        Toast.show("未识别到文字，请手动输入");
      }
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "识别失败");
    }
  }

  /** 新增材料弹窗：拍照/相册识别条码并填入。 */
  async function scanNewMaterialBarcode(f: File | undefined) {
    if (!f) return;
    try {
      const up = await fileApi.upload(f, "ocr");
      const data = await ocrApi.decodeBarcode(up.file_id);
      setNewMaterial((s) => ({ ...s, barcode: data.barcode }));
      Toast.show(`条码：${data.barcode}`);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "未识别到条码");
    }
  }

  /** 送货单识别入口：拍照 / 相册二选一。 */
  function openOcrSheet() {
    ActionSheet.show({
      actions: [
        { key: "camera", text: "📷 拍照送货单" },
        { key: "album", text: "🖼 从相册选择" },
      ],
      cancelText: "取消",
      onAction: (a) => {
        if (a.key === "camera") ocrCamRef.current?.click();
        else if (a.key === "album") ocrAlbRef.current?.click();
      },
    });
  }

  /** 拍照/相册送货单：上传 → 视觉识别（异步任务，视觉大模型等待 30-60s）→ 轮询结果。 */
  async function startDeliveryOcr(f: File | undefined) {
    if (!f || ocrLoading) return;
    setOcrLoading(true);
    try {
      const up = await fileApi.upload(f, "purchase_bill");
      const t = await ocrApi.recognize(up.file_id, 1, "auto");
      pollOcr(t.task_id);
    } catch (e) {
      setOcrLoading(false);
      Toast.show(e instanceof Error ? e.message : "上传失败");
    }
  }

  /** 轮询识别任务：5s/次，最多 24 次（2 分钟超时，与桌面端一致）。 */
  function pollOcr(id: string) {
    if (ocrTimerRef.current) clearInterval(ocrTimerRef.current);
    let ticks = 0;
    ocrTimerRef.current = setInterval(async () => {
      let finished = false;
      try {
        const t = await ocrApi.taskStatus(id);
        if (t.status === "done") {
          finished = true;
          clearInterval(ocrTimerRef.current);
          setOcrLoading(false);
          const s = t.structured;
          setOcrTask(t);
          setOcrConfirm({ supplierName: s?.supplier_name ?? "", billNo: s?.bill_no ?? "", items: s?.items ?? [] });
          Toast.show("识别完成，请确认明细");
        } else if (t.status === "failed") {
          finished = true;
          clearInterval(ocrTimerRef.current);
          setOcrLoading(false);
          Toast.show(t.error ?? "识别失败");
        }
      } catch (e) {
        finished = true;
        clearInterval(ocrTimerRef.current);
        setOcrLoading(false);
        Toast.show(e instanceof Error ? e.message : "查询失败");
      } finally {
        // 任务已完成/失败时不再继续计数，避免第 24 次恰好成功时误报「识别超时」
        if (finished) return;
        ticks += 1;
        if (ticks >= 24) {
          clearInterval(ocrTimerRef.current);
          setOcrLoading(false);
          Toast.show("识别超时（>2 分钟），请重试");
        }
      }
    }, 5000);
  }

  /** 确认识别结果：供应商落库 + 物料自动匹配/新增（复用桌面端 deliveryConfirm）→ 明细带入表单，用户核对库位/数量后提交。 */
  async function confirmDelivery() {
    if (!ocrConfirm || !ocrTask || ocrLoading) return;
    setOcrLoading(true);
    try {
      const data = await ocrApi.deliveryConfirm({
        record_id: ocrTask.record_id,
        supplier_name: ocrConfirm.supplierName.trim(),
        bill_no: ocrConfirm.billNo.trim(),
        items: ocrConfirm.items
          .filter((it) => it.product_name?.trim())
          .map((it) => ({
            product_name: it.product_name,
            material_code: it.material_code ?? "",
            spec: it.spec ?? "",
            unit: it.unit ?? "",
            qty: it.qty ?? "1",
            price: it.price ?? "0",
            amount: it.amount ?? "",
          })),
      });
      // 逐项拉取完整商品带入明细（跳过查询失败项与已在明细中的重复项）
      const injected: Row[] = [];
      for (const it of data.items) {
        try {
          const p = await baseApi.product(it.product_id);
          if (!rows.some((r) => r.product.id === p.id)) {
            injected.push({ product: p, qty: it.qty ?? "1", price: it.price ?? "0", barcode: p.barcode ?? "" });
          }
        } catch {
          // 商品已停用/删除：跳过该行
        }
      }
      setRows((rs) => [...rs, ...injected]);
      if (data.supplier_id) setSupplierId(data.supplier_id);
      setOcrConfirm(null);
      setOcrTask(null);
      Toast.show(
        `已带入 ${injected.length} 项材料${data.supplier_created ? "（自动创建新供应商）" : ""}${data.supplier_matched_name ? `（关联供应商：${data.supplier_matched_name}）` : ""}${data.created_products?.length ? `（自动新增 ${data.created_products.length} 个物料）` : ""}，请核对库位/数量后提交`
      );
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "确认失败");
    } finally {
      setOcrLoading(false);
    }
  }

  /** 取消识别/关闭确认弹层。 */
  function cancelOcr() {
    if (ocrTimerRef.current) clearInterval(ocrTimerRef.current);
    setOcrLoading(false);
    setOcrConfirm(null);
    setOcrTask(null);
  }

  /** 无材料新增：用识别数据（条码/名称/规格）创建材料并带入明细行。 */
  async function saveNewMaterial() {
    const m = newMaterial;
    if (!m.name.trim()) return Toast.show("请输入材料名称");
    if (!m.unitId) return Toast.show("请选择单位");
    try {
      const p = await baseApi.createProduct({ name: m.name.trim(), barcode: m.barcode.trim(), spec: m.spec.trim(), unit_id: m.unitId });
      updateRow(m.rowIndex, { product: p });
      Toast.show(`材料已新增：${p.name}`);
      setNewMaterial((s) => ({ ...s, open: false }));
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "新增失败");
    }
  }

  async function submit() {
    if (!warehouseId) return Toast.show("请选择仓库");
    if (!rows.length) return Toast.show("请添加材料");
    for (const r of rows) {
      if (!r.location) return Toast.show(`请选择 ${r.product.name} 的库位`);
      if (!r.qty || Number(r.qty) <= 0) return Toast.show(`请填写 ${r.product.name} 的数量`);
    }
    setSubmitting(true);
    try {
      const items = rows.map((r) => ({ product_id: r.product.id, qty: r.qty, price: r.price || "0", location_id: r.location!.id }));
      const data = await purchaseIn(warehouseId, items, remark, supplierId, billDate ? `${billDate.getFullYear()}-${String(billDate.getMonth() + 1).padStart(2, "0")}-${String(billDate.getDate()).padStart(2, "0")}T00:00:00` : undefined);
      Toast.show(`入库成功：${data.bill_no}`);
      navigate("/", { replace: true });
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "入库失败");
    } finally {
      setSubmitting(false);
    }
  }

  const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/")}>入库</NavBar>

      {/* 表头（标题行） */}
      <List header="表头信息">
        <List.Item extra={
          <select value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))} style={{ border: "none", background: "transparent", fontSize: 15 }}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        }>入库仓库</List.Item>
        <List.Item onClick={() => setSupPicker(true)} arrow="horizontal" extra={supplierId ? (suppliers.find((s) => s.id === supplierId)?.name ?? "-") : "可选"}>供应商</List.Item>
        <List.Item onClick={() => setDatePicker(true)} arrow="horizontal" extra={fmtDate(billDate)}>入库日期</List.Item>
        <List.Item extra={<Input placeholder="备注（可选）" value={remark} onChange={setRemark} style={{ textAlign: "right" }} />}>备注</List.Item>
        <List.Item onClick={() => void openOcrSheet()} arrow="horizontal" extra={ocrLoading ? <DotLoading color="primary" /> : "拍照/相册"}>
          送货单识别
        </List.Item>
      </List>

      {/* 材料明细：标题栏 + 操作提示 */}
      <div style={{ background: "#fff", margin: "12px 12px 0", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #f0f1f3" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#1d2129" }}>材料明细</span>
            <span style={{ fontSize: 12, color: "#646a73" }}>{rows.length} 项</span>
          </div>
          <span style={{ fontSize: 12, color: "#646a73" }}>条码可识别 / 手输后回车</span>
        </div>
        <List>
          {rows.map((r, i) => (
            <List.Item key={i} description={
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                {/* 操作行：库位选择 + 扫码 / 删除 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Tag color="primary" fill="outline" onClick={() => void pickLocation(i)}>{r.location ? r.location.display ?? r.location.code : "选库位"}</Tag>
                  <span style={{ flex: 1 }} />
                  <Tag color="success" fill="outline" onClick={() => { setScanRow(i); setScannerOpen(true); }}>识别</Tag>
                  <Tag color="danger" fill="outline" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>删除</Tag>
                </div>
                {/* 数量 / 价格 */}
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#646a73", marginBottom: 2 }}>数量</div>
                    <Input placeholder="必填" type="number" value={r.qty} onChange={(v) => updateRow(i, { qty: v })} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid #eee", borderRadius: 6, padding: "4px 8px" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#646a73", marginBottom: 2 }}>价格</div>
                    <Input placeholder="0" type="number" value={r.price} onChange={(v) => updateRow(i, { price: v })} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid #eee", borderRadius: 6, padding: "4px 8px" }} />
                  </div>
                </div>
                {/* 条码：扫码或手输后回车自动匹配 */}
                <div>
                  <div style={{ fontSize: 11, color: "#646a73", marginBottom: 2 }}>条码（识别或手输后回车自动匹配）</div>
                  <Input placeholder="未匹配时自动填入条码" value={r.barcode} onChange={(v) => updateRow(i, { barcode: v })} onEnterPress={() => void scanBarcode(i, r.barcode)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid #eee", borderRadius: 6, padding: "4px 8px" }} />
                </div>
                <span style={{ color: "#646a73", fontSize: 12 }}>{r.product.code}{r.product.spec ? ` / ${r.product.spec}` : ""} / {r.product.unit_name}</span>
              </div>
            }>{r.product.name}</List.Item>
          ))}
          <List.Item onClick={() => setPickerOpen(true)} arrow="horizontal">+ 添加材料</List.Item>
        </List>
      </div>

      <div style={{ padding: 16 }}>
        <Button block color="primary" loading={submitting} onClick={() => void submit()}>提交入库</Button>
      </div>

      <input ref={ocrCamRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void startDeliveryOcr(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={ocrAlbRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void startDeliveryOcr(e.target.files?.[0]); e.target.value = ""; }} />

      <ProductPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(p) => addRow(p)} />
      <BarcodeScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScan={(code, product) => void scanBarcode(scanRow, code, true, product)} />

      <Popup visible={locPicker.open} onMaskClick={() => setLocPicker((s) => ({ ...s, open: false }))} bodyStyle={{ height: "50vh" }}>
        <List header="选择库位">
          {locPicker.locations.map((l) => (
            <List.Item key={l.id} onClick={() => { updateRow(locPicker.rowIndex, { location: l }); setLocPicker((s) => ({ ...s, open: false })); }}>{l.display ?? l.code}</List.Item>
          ))}
          {!locPicker.locations.length && <List.Item>该仓库暂无库位</List.Item>}
        </List>
      </Popup>

      <Popup visible={supPicker} onMaskClick={() => setSupPicker(false)} bodyStyle={{ height: "50vh" }}>
        <List header="选择供应商">
          {suppliers.map((s) => (
            <List.Item key={s.id} onClick={() => { setSupplierId(s.id); setSupPicker(false); }}>{s.name}</List.Item>
          ))}
          {!suppliers.length && <List.Item>暂无供应商，可在电脑端「供应商管理」添加</List.Item>}
        </List>
      </Popup>

      <Popup visible={datePicker} onMaskClick={() => setDatePicker(false)} bodyStyle={{ height: "auto" }}>
        <DatePicker precision="day" value={billDate} onClose={() => setDatePicker(false)} onConfirm={(v) => { setBillDate(v); setDatePicker(false); }} />
      </Popup>

      {/* 送货单识别结果确认 */}
      <Popup visible={!!ocrConfirm} onMaskClick={cancelOcr} bodyStyle={{ height: "auto", maxHeight: "80vh" }}>
        <div style={{ padding: 16 }}>
          <h4 style={{ margin: "0 0 4px" }}>送货单识别结果</h4>
          <p style={{ color: "#646a73", fontSize: 12, margin: "0 0 12px" }}>识别内容可修改；确认后供应商落库、物料自动匹配/新增并带入明细</p>
          <List>
            <List.Item extra={<Input placeholder="识别到的供应商（可改）" value={ocrConfirm?.supplierName ?? ""} onChange={(v) => setOcrConfirm((s) => (s ? { ...s, supplierName: v } : s))} />}>
              供应商
            </List.Item>
            <List.Item extra={<Input placeholder="送货单号（可改）" value={ocrConfirm?.billNo ?? ""} onChange={(v) => setOcrConfirm((s) => (s ? { ...s, billNo: v } : s))} />}>
              单据号
            </List.Item>
          </List>
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>明细（{ocrConfirm?.items.length ?? 0} 项）</div>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {ocrConfirm?.items.map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.product_name}
                    {it.spec ? `（${it.spec}）` : ""}
                    {it.category_name ? ` / ${it.category_name}` : ""}
                  </span>
                  <span style={{ color: "#666" }}>{it.qty || "1"} × ¥{it.price || "0"}</span>
                </div>
              ))}
              {!ocrConfirm?.items.length && <div style={{ color: "#646a73", padding: "8px 0" }}>未识别到明细条目，可确认后手动添加材料</div>}
            </div>
          </div>
          <Button block color="primary" style={{ marginTop: 12 }} loading={ocrLoading} onClick={() => void confirmDelivery()}>
            确认并带入入库
          </Button>
          <Button block fill="outline" style={{ marginTop: 8 }} disabled={ocrLoading} onClick={cancelOcr}>
            取消
          </Button>
        </div>
      </Popup>

      {/* 无材料新增 */}
      <Popup visible={newMaterial.open} onMaskClick={() => setNewMaterial((s) => ({ ...s, open: false }))} bodyStyle={{ height: "auto" }}>
        <div style={{ padding: 16 }}>
          <h4 style={{ margin: "0 0 4px" }}>新增材料</h4>
          <p style={{ color: "#646a73", fontSize: 12, margin: "0 0 12px" }}>未匹配到该条码对应的材料，确认信息后新增（条码可选）</p>
          <List>
            <List.Item extra={
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <Input placeholder="如：轴承6204" value={newMaterial.name} onChange={(v) => setNewMaterial((s) => ({ ...s, name: v }))} />
                <CameraAlbum onPick={(f) => void ocrNewMaterialName(f)} />
              </div>
            }>材料名称</List.Item>
            <List.Item extra={
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <Input placeholder="识别到的条码" value={newMaterial.barcode} onChange={(v) => setNewMaterial((s) => ({ ...s, barcode: v }))} />
                <CameraAlbum onPick={(f) => void scanNewMaterialBarcode(f)} />
              </div>
            }>条码</List.Item>
            <List.Item extra={<Input placeholder="可选" value={newMaterial.spec} onChange={(v) => setNewMaterial((s) => ({ ...s, spec: v }))} />}>型号规格</List.Item>
            <List.Item extra={
              <select value={newMaterial.unitId} onChange={(e) => setNewMaterial((s) => ({ ...s, unitId: Number(e.target.value) }))} style={{ border: "none", background: "transparent", fontSize: 15 }}>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            }>单位</List.Item>
          </List>
          <Button block color="primary" style={{ marginTop: 12 }} onClick={() => void saveNewMaterial()}>保存并加入明细</Button>
        </div>
      </Popup>
    </div>
  );
}
