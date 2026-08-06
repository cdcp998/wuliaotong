import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { App, AutoComplete, Button, DatePicker, Divider, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Tag } from "antd";
import { CameraOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useNavigate, useSearchParams } from "react-router";

import { baseApi, fileApi, ocrApi, purchaseApi, purchaseIn, resolveByBarcode, type HistoryPriceRow, type Product, type PurchaseInBill, type PurchaseInDetail, type Shelf, type Supplier } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

import { BillDetailDrawer } from "../components/BillDetailDrawer";

interface Row {
  key: number;
  product: Product | null; // 选中材料快照
  material_code: string; // 物料编码（OCR 带入或手输，可编辑）
  spec: string; // 规格型号（可编辑）
  unit: string; // 单位（OCR 识别优先，产品资料兜底）
  barcode: string; // 条形码（可选）：扫码枪/手输/拍照
  location_id: number | undefined;
  qty: number;
  price: number; // 金额（进价）
}

/** OCR 预填条目（送货单确认结果带入：含 product_id=已匹配/自动新增的物料）。 */
interface PrefillItem {
  product_id?: number;
  product_name: string;
  material_code?: string;
  spec?: string;
  unit?: string;
  qty?: string;
  price?: string;
}

/** 新建入库（重写版）：表头（仓库/供应商/日期）+ 可编辑明细表格（物料编码/条码相机/名称OCR+大模型/规格/单位/金额/数量）。 */
export function PurchaseInPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [list, setList] = useState<PurchaseInBill[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PurchaseInDetail | null>(null);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [units, setUnits] = useState<{ id: number; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locs, setLocs] = useState<{ id: number; code: string }[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]); // 当前仓库货架（创建新仓位用）
  // 送货单 OCR 预填（sessionStorage 消费后即删，防重复导入；兼容 URL 参数直达）
  const [prefillItems, setPrefillItems] = useState<PrefillItem[]>([]);
  const [prefillSupplierName, setPrefillSupplierName] = useState(""); // 预填供应商名（自动创建的新供应商可能不在下拉列表，用于回显）
  const prefillDone = useRef(false); // 防 StrictMode/dev 双执行导致明细重复导入
  const prefillConsumed = useRef(false); // 防 StrictMode/dev 双执行导致 sessionStorage 消费后 supplierId 被 URL 参数覆盖
  // 明细表格：列宽拖拽 + 行高密度
  const [submitTried, setSubmitTried] = useState(false); // 提交校验失败后高亮缺失项（材料/库位）
  // 创建新仓位：库位下拉「＋ 创建新仓位」→ 弹窗（货架+层号）→ 保存后立即选中
  const [locModal, setLocModal] = useState<{ open: boolean; rowKey: number } | null>(null);
  const [locSaving, setLocSaving] = useState(false);
  const [locForm] = Form.useForm();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [supplierId, setSupplierId] = useState<number>(0);
  const [billDate, setBillDate] = useState<string>("");
  const [remark, setRemark] = useState("");
  const [ocrRecordId, setOcrRecordId] = useState(0);
  const [ocrBillNo, setOcrBillNo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(1);
  // 相机输入目标列：barcode=条码列 / name=材料名称列
  const scanTarget = useRef<{ kind: "barcode" | "name"; rowKey: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 无材料新增（条码/OCR 未匹配 → 新增材料弹窗，预填识别数据）
  const [materialModal, setMaterialModal] = useState<{ open: boolean; rowKey: number; barcode: string; name: string; spec: string }>({ open: false, rowKey: -1, barcode: "", name: "", spec: "" });
  const [materialForm] = Form.useForm();
  // 大模型兜底分析结果（OCR 未匹配 → 分析 → 人工确认新增，单位可选）
  const [llmModal, setLlmModal] = useState<{ open: boolean; rowKey: number; name: string; spec: string; unitId?: number } | null>(null);
  // 历史采购价
  const [histOpen, setHistOpen] = useState(false);
  const [histTitle, setHistTitle] = useState("");
  const [histRows, setHistRows] = useState<HistoryPriceRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  // 物料编码查询：行 → AutoComplete 候选（服务端防抖搜索，候选含完整材料用于回填）
  const [matOptions, setMatOptions] = useState<Record<number, { value: string; label: string; product: Product }[]>>({});
  const matDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 材料名称查询：行 → Select 候选（服务端防抖搜索，全库匹配，候选含完整材料）
  const [nameOptions, setNameOptions] = useState<Record<number, { value: number; label: string; product: Product }[]>>({});
  const nameDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** 物料编码查询：防抖搜索系统材料（匹配物料编码/名称/编码），选中即填充整行。 */
  function queryByMaterialCode(key: number, keyword: string) {
    if (matDebounce.current) clearTimeout(matDebounce.current);
    const kw = keyword.trim();
    if (!kw) {
      setMatOptions((m) => ({ ...m, [key]: [] }));
      return;
    }
    matDebounce.current = setTimeout(() => {
      void baseApi.products(kw).then((data) => {
        // 候选 value 直接用物料编码：选中回填编码列与 onChange 一致，避免 id/编码串位
        // 仅物料编码非空且匹配的物料（符合「按编码搜索仅限存在对应编码的物料」）
        const list = data.list
          .filter((p) => p.material_code && p.material_code.toLowerCase().includes(kw.toLowerCase()))
          .slice(0, 10)
          .map((p) => ({
            value: p.material_code,
            label: `${p.material_code} · ${p.name}${p.spec ? `（${p.spec}）` : ""}`,
            product: p,
          }));
        setMatOptions((m) => ({ ...m, [key]: list }));
      });
    }, 300);
  }

  /** 材料名称查询：防抖搜索系统材料（名称/规格/物料编码/条码字段级匹配，物料编码或条码精确命中优先置顶），选中即填充整行。 */
  function queryByName(key: number, keyword: string) {
    if (nameDebounce.current) clearTimeout(nameDebounce.current);
    const kw = keyword.trim();
    if (!kw) {
      setNameOptions((m) => ({ ...m, [key]: [] }));
      return;
    }
    nameDebounce.current = setTimeout(() => {
      void baseApi.products(kw).then((data) => {
        const lower = kw.toLowerCase();
        // 字段级匹配：仅物料确实在名称/规格/物料编码/条码上命中才显示（后端 keyword 为全字段模糊，此处二次过滤保证）
        const list = data.list.filter(
          (p) =>
            p.name.toLowerCase().includes(lower) ||
            (p.spec && p.spec.toLowerCase().includes(lower)) ||
            (p.material_code && p.material_code.toLowerCase().includes(lower)) ||
            (p.barcode && p.barcode.toLowerCase().includes(lower))
        );
        // 物料编码/条码精确命中优先置顶（用户按编码/条码搜索时目标物料必在最前）
        const exact = list.filter((p) => p.material_code === kw || p.barcode === kw);
        const ranked = [...exact, ...list.filter((p) => !exact.includes(p))].slice(0, 10);
        setNameOptions((m) => ({
          ...m,
          [key]: ranked.map((p) => ({
            value: p.id,
            label: `${p.name}${p.material_code ? ` · ${p.material_code}` : ""}${p.spec ? `（${p.spec}）` : ""}`,
            product: p,
          })),
        }));
      });
    }, 300);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
      const data = await purchaseApi.list(page, pageSize);
      setList(data.list);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.warehouses().then((ws) => setWarehouses(ws.filter((w) => w.status === 1).map((w) => ({ id: w.id, name: w.name }))));
    baseApi.suppliers(1).then((d) => setSuppliers(d.list)).catch(() => undefined);
    baseApi.units().then(setUnits).catch(() => undefined);
    // 材料下拉加载更多（前 500 条），避免预填/选择时查不到材料导致单位/规格显示不全
    baseApi.products("", 1, { pageSize: 500 }).then((p) => setProducts(p.list)).catch(() => undefined);
    // 送货单 OCR 带入：优先 sessionStorage（消费即删，保证只导入一次），兼容 URL 参数直达。
    // StrictMode（dev）会双执行本 effect：sessionStorage 首次消费后即被删除，若第二次再走
    // else 分支会把 supplierId/ocrRecordId 覆盖回 URL 参数（无参数即 0）→ 用 ref 保证只消费一次。
    if (prefillConsumed.current) return;
    const pre = sessionStorage.getItem("purchaseInPrefill");
    if (pre) {
      prefillConsumed.current = true;
      sessionStorage.removeItem("purchaseInPrefill");
      try {
        const d = JSON.parse(pre) as { items?: PrefillItem[]; supplierId?: number; supplierName?: string; ocrRecordId?: number; billNo?: string };
        if (d.items?.length) {
          setPrefillItems(d.items);
          setSupplierId(d.supplierId ?? 0);
          setPrefillSupplierName(d.supplierName ?? "");
          setOcrRecordId(d.ocrRecordId ?? 0);
          setOcrBillNo(d.billNo ?? "");
        }
      } catch {
        /* 忽略损坏的预填数据 */
      }
    } else {
      setSupplierId(Number(params.get("supplier_id") ?? 0));
      setOcrRecordId(Number(params.get("ocr_record_id") ?? 0));
      setOcrBillNo(params.get("bill_no") ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从送货单 OCR 结果预填明细：sessionStorage 优先，URL ?items=JSON 兼容直达
  const urlPrefill: PrefillItem[] = useMemo(() => {
    try {
      const raw = params.get("items");
      return raw ? (JSON.parse(decodeURIComponent(raw)) as PrefillItem[]) : [];
    } catch {
      return [];
    }
  }, [params]);
  const prefill = useMemo(() => (prefillItems.length ? prefillItems : urlPrefill), [prefillItems, urlPrefill]);

  useEffect(() => {
    // 只预填一次：StrictMode（dev）下 effect 会双执行，用 ref 锁防止明细重复导入
    if (prefillDone.current || !prefill.length || open) return;
    prefillDone.current = true;
    setOpen(true);
    void (async () => {
      const rs: Row[] = [];
      for (const it of prefill) {
        let p: Product | undefined;
        try {
          if (it.product_id) {
            // 送货单确认时已匹配/自动新增的物料：直接按 id 取材料
            p = await baseApi.product(it.product_id);
          } else if (it.material_code) {
            const data = await baseApi.products(it.material_code);
            p = data.list.find((x) => x.material_code === it.material_code) ?? undefined;
          }
          if (!p) {
            const found = await baseApi.products(it.product_name);
            p = found.list.find((x) => x.name === it.product_name) ?? found.list[0];
          }
        } catch {
          p = undefined;
        }
        rs.push({
          key: nextKey + rs.length,
          product: p ?? null,
          material_code: p?.material_code ?? it.material_code ?? "",
          spec: it.spec || p?.spec || "",
          unit: it.unit || p?.unit_name || "",
          barcode: "",
          location_id: undefined,
          qty: Number(it.qty ?? 1),
          price: Number(it.price ?? 0),
        });
      }
      setRows((old) => [...old, ...rs]);
      setNextKey((k) => k + rs.length);
      if (rs.some((r) => !r.product)) message.warning("部分材料未匹配到系统资料，可当场新增或手动选择");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, open]);

  async function loadLocs(whId: number) {
    setLocs((await baseApi.locations(whId)).map((l) => ({ id: l.id, code: l.code })));
    baseApi.shelves(whId).then(setShelves).catch(() => undefined);
  }

  /** 创建新仓位：保存后立即选中当前行（编码由服务端自动生成：仓库编码-货架编码-层号）。 */
  async function createLocationNow() {
    if (!locModal) return;
    if (!warehouseId) {
      message.warning("请先在上方选择入库仓库");
      return;
    }
    const v = await locForm.validateFields();
    setLocSaving(true);
    try {
      const loc = await baseApi.createLocation({
        warehouse_id: warehouseId,
        shelf_id: v.shelf_id,
        layer_no: v.layer_no,
        remark: (v.remark ?? "").trim(),
      });
      setLocs((ls) => [...ls, { id: loc.id, code: loc.code }]);
      setRow(locModal.rowKey, { location_id: loc.id });
      message.success(`仓位已创建并选中：${loc.code}`);
      setLocModal(null);
      locForm.resetFields();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建仓位失败");
    } finally {
      setLocSaving(false);
    }
  }

  /** 供应商下拉选项：预填的自动创建供应商不在列表时回显其名称（避免显示数字 id）。 */
  const supplierOptions = useMemo(() => {
    const list = suppliers.map((s) => ({ value: s.id, label: s.name }));
    if (supplierId && prefillSupplierName && !list.some((o) => o.value === supplierId)) {
      list.unshift({ value: supplierId, label: prefillSupplierName });
    }
    return list;
  }, [suppliers, supplierId, prefillSupplierName]);

  function setRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addEmptyRow() {
    setRows((rs) => [...rs, { key: nextKey, product: null, material_code: "", spec: "", unit: "", barcode: "", location_id: undefined, qty: 1, price: 0 }]);
    setNextKey((k) => k + 1);
  }

  /** 条形码识别：命中材料直接带入；未命中弹「新增材料」。 */
  async function scanBarcode(key: number, value: string) {
    const b = value.trim();
    if (!b) return;
    try {
      const p = await resolveByBarcode(b);
      if (p) {
        setRow(key, { product: p, material_code: p.material_code, spec: p.spec, unit: p.unit_name });
        message.success(`条码匹配：${p.name}`);
      } else {
        setMaterialModal({ open: true, rowKey: key, barcode: b, name: "", spec: "" });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "条码查询失败");
    }
  }

  /** 相机输入统一入口：条码拍照解码 / 材料名称拍照 OCR + 大模型兜底。 */
  async function handleCameraFile(f: File | undefined) {
    const target = scanTarget.current;
    if (!f || !target) return;
    try {
      const up = await fileApi.upload(f, "ocr");
      if (target.kind === "barcode") {
        const data = await ocrApi.decodeBarcode(up.file_id);
        await scanBarcode(target.rowKey, data.barcode);
      } else {
        const data = await ocrApi.quick(up.file_id, 2);
        if (data.matches.length) {
          const m = data.matches[0];
          const p = await baseApi.product(m.product_id);
          setRow(target.rowKey, { product: p, material_code: p.material_code, spec: p.spec, unit: p.unit_name });
          message.success(`OCR 匹配：${p.name}`);
        } else {
          // 大模型兜底分析：生成建议 → 人工确认新增
          const sug = await ocrApi.match(data.record_id);
          const spec = String(sug.detail?.spec ?? "");
          setLlmModal({ open: true, rowKey: target.rowKey, name: sug.product_name, spec });
          setMaterialModal((s) => ({ ...s, open: false }));
        }
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "识别失败");
    }
  }

  /** 无材料新增：用识别数据（条码/名称/规格）创建材料并带入明细行。 */
  async function createMaterial() {
    const v = await materialForm.validateFields();
    try {
      const p = await baseApi.createProduct({
        name: v.name.trim(),
        barcode: (v.barcode ?? "").trim(),
        spec: (v.spec ?? "").trim(),
        unit_id: v.unit_id,
      });
      setProducts((ps) => [...ps, p]);
      setRow(materialModal.rowKey, { product: p, material_code: p.material_code, spec: p.spec, unit: p.unit_name });
      message.success(`材料已新增：${p.name}`);
      setMaterialModal((s) => ({ ...s, open: false }));
      materialForm.resetFields();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "新增失败");
    }
  }

  /** 大模型兜底确认：按分析结果新增材料（单位默认首个单位，可在弹窗中选择）并带入。 */
  async function acceptLlmSuggestion() {
    if (!llmModal) return;
    try {
      const p = await baseApi.createProduct({ name: llmModal.name.trim(), spec: llmModal.spec.trim(), unit_id: llmModal.unitId ?? units[0]?.id ?? 0 });
      setProducts((ps) => [...ps, p]);
      setRow(llmModal.rowKey, { product: p, material_code: p.material_code, spec: p.spec, unit: p.unit_name });
      message.success(`已按大模型分析新增：${p.name}`);
      setLlmModal(null);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "新增失败");
    }
  }

  /** 材料名称历史价格查询（可按当前表头供应商过滤）。 */
  async function openHistory(p: Product) {
    setHistTitle(`${p.name} 历史采购价${supplierId ? "（当前供应商）" : "（全部供应商）"}`);
    setHistOpen(true);
    setHistLoading(true);
    setHistRows([]);
    try {
      const data = await purchaseApi.historyPrice({ productId: p.id, supplierId });
      setHistRows(data.list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
    } finally {
      setHistLoading(false);
    }
  }

  async function create() {
    if (!warehouseId) return message.warning("请选择入库仓库");
    if (!rows.length) return message.warning("请先添加明细");
    // 逐项校验并高亮缺失项（比笼统提示「至少一条有效明细」更明确）
    const missingProduct = rows.filter((r) => !r.product);
    if (missingProduct.length) {
      setSubmitTried(true);
      return message.warning(`有 ${missingProduct.length} 行未匹配到材料（已标红），请在「材料名称」列选择或拍照新增`);
    }
    const missingLoc = rows.filter((r) => !r.location_id);
    if (missingLoc.length) {
      setSubmitTried(true);
      return message.warning(`请为 ${missingLoc.length} 行明细选择库位（已标红）`);
    }
    const items = rows
      .filter((r) => r.qty > 0)
      .map((r) => ({ product_id: r.product!.id, qty: String(r.qty), price: String(r.price || 0), location_id: r.location_id! }));
    if (!items.length) return message.warning("请至少填写一条数量大于 0 的明细");
    try {
      const data = await purchaseIn(warehouseId, items, remark, supplierId, billDate || undefined, ocrRecordId);
      sessionStorage.removeItem("purchaseInPrefill"); // 预填已消费，清除防止刷新重复导入
      message.success(`入库成功：${data.bill_no}`);
      setOpen(false);
      setRows([]);
      setSubmitTried(false);
      navigate("/purchase-in", { replace: true });
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "入库失败");
    }
  }

  const billColumns: ColumnsType<PurchaseInBill> = [
    {
      title: "单号",
      dataIndex: "bill_no",
      render: (v: string, r) => (
        <a
          onClick={async () => {
            try {
              setDetail(await purchaseApi.detail(r.id));
              setDetailOpen(true);
            } catch (e) {
              message.error(e instanceof Error ? e.message : "加载失败");
            }
          }}
        >
          {v}
        </a>
      ),
    },
    { title: "仓库", dataIndex: "warehouse_name" },
    { title: "供应商", dataIndex: "supplier_name" },
    { title: "数量", dataIndex: "total_qty" },
    { title: "金额", dataIndex: "total_amount" },
    { title: "日期", dataIndex: "bill_date" },
    {
      title: "操作",
      width: 90,
      render: (_, r) =>
        r.status === 1 ? (
          <Popconfirm title="确认作废（反向冲销库存，仅当日）？" onConfirm={async () => { try { await purchaseApi.void(r.id); message.success("已作废"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
            <Button size="small" danger>作废</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  const columns: ColumnsType<Row> = [
    {
      title: "物料编码",
      dataIndex: "material_code",
      key: "material_code",
      width: 190,
      render: (v: string, r) => (
        <AutoComplete
          style={{ width: "100%" }}
          value={v}
          options={matOptions[r.key] ?? []}
          placeholder="输入物料编码查询 / 手输"
          notFoundContent="无匹配物料（可手输）"
          allowClear
          onChange={(val) => {
            // 选中候选（onSelect 已/将回填整行）：仅保持编码一致，不动材料选择
            const hit = (matOptions[r.key] ?? []).find((o) => o.value === val);
            if (hit) {
              setRow(r.key, { material_code: val });
              return;
            }
            // 手输/清空：编码与当前已选材料不一致时同步清除材料选择，避免列间显示与实际提交矛盾
            setRow(r.key, { material_code: val });
            if (r.product && r.product.material_code !== val) {
              setRow(r.key, { product: null, spec: "", unit: "" });
            }
          }}
          onSearch={(kw) => queryByMaterialCode(r.key, kw)}
          onSelect={(val) => {
            // 候选 value 即物料编码：选中后回填该物料完整信息（材料名称列随之显示对应名称）
            const hit = (matOptions[r.key] ?? []).find((o) => o.value === val);
            const p = hit?.product;
            if (p) setRow(r.key, { product: p, material_code: p.material_code, spec: p.spec, unit: p.unit_name });
          }}
        />
      ),
    },
    {
      title: "条形码",
      dataIndex: "barcode",
      key: "barcode",
      width: 170,
      render: (v: string, r) => (
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={v}
            placeholder="扫码枪/手输"
            onChange={(e) => setRow(r.key, { barcode: e.target.value })}
            onPressEnter={(e) => void scanBarcode(r.key, (e.target as HTMLInputElement).value)}
          />
          <Button icon={<CameraOutlined />} title="拍照识别条码" onClick={() => { scanTarget.current = { kind: "barcode", rowKey: r.key }; fileRef.current?.click(); }} />
        </Space.Compact>
      ),
    },
    {
      title: "材料名称",
      dataIndex: "product",
      key: "product",
      width: 240,
      render: (_p: Product | null, r) => (
        <Space.Compact style={{ width: "100%" }}>
          <Select
            style={{ width: "100%" }}
            showSearch
            filterOption={false}
            placeholder="输入名称搜索 / 选择"
            value={r.product?.id}
            status={submitTried && !r.product ? "error" : undefined}
            notFoundContent="无匹配材料"
            allowClear
            onSearch={(kw) => queryByName(r.key, kw)}
            options={[
              // 当前行材料不在搜索结果里时也回显名称（预填/已选材料）
              ...(r.product && !(nameOptions[r.key] ?? []).some((o) => o.value === r.product!.id)
                ? [{ value: r.product.id, label: `${r.product.name}${r.product.material_code ? ` · ${r.product.material_code}` : ""}` }]
                : []),
              ...(nameOptions[r.key] ?? []),
            ]}
            onChange={(v) => {
              // 清空选择：取消当前材料（同步清空其带入的物料编码/规格/单位）
              if (v === undefined) {
                setRow(r.key, { product: null, material_code: "", spec: "", unit: "" });
                return;
              }
              // 优先用服务端搜索结果里的完整材料（可能不在本地前 500 条），兜底本地列表
              const hit = (nameOptions[r.key] ?? []).find((o) => o.value === v);
              const x = hit?.product ?? products.find((it) => it.id === v);
              if (x) setRow(r.key, { product: x, material_code: x.material_code, spec: x.spec, unit: x.unit_name });
            }}
          />
          <Button icon={<CameraOutlined />} title="拍照 OCR 识别（未匹配自动大模型分析）" onClick={() => { scanTarget.current = { kind: "name", rowKey: r.key }; fileRef.current?.click(); }} />
          {r.product && (
            <Button size="small" type="link" style={{ padding: "0 6px" }} onClick={() => void openHistory(r.product!)}>历史价</Button>
          )}
        </Space.Compact>
      ),
    },
    {
      title: "规格型号",
      dataIndex: "spec",
      key: "spec",
      width: 180,
      render: (v: string, r) => <Input value={v} onChange={(e) => setRow(r.key, { spec: e.target.value })} placeholder="可空" />,
    },
    {
      title: "单位",
      dataIndex: "unit",
      key: "unit",
      width: 90,
      render: (_, r) => r.unit || r.product?.unit_name || "-",
    },
    {
      title: "金额（进价）",
      dataIndex: "price",
      key: "price",
      width: 110,
      render: (v: number, r) => <InputNumber min={0} precision={2} style={{ width: "100%" }} value={v} onChange={(x) => setRow(r.key, { price: x ?? 0 })} />,
    },
    {
      title: "数量",
      dataIndex: "qty",
      key: "qty",
      width: 100,
      render: (v: number, r) => <InputNumber min={0.001} precision={3} style={{ width: "100%" }} value={v} onChange={(x) => setRow(r.key, { qty: x ?? 0 })} />,
    },
    {
      title: "库位",
      dataIndex: "location_id",
      key: "location_id",
      width: 130,
      render: (v: number | undefined, r) => (
        <Select
          style={{ width: "100%" }}
          placeholder="必选"
          showSearch
          options={locs}
          fieldNames={{ label: "code", value: "id" }}
          value={v}
          status={submitTried && !v ? "error" : undefined}
          onChange={(x) => setRow(r.key, { location_id: x })}
          dropdownRender={(menu) => (
            <>
              {menu}
              <Divider style={{ margin: "6px 0" }} />
              <Button
                type="text"
                block
                icon={<PlusOutlined />}
                onClick={() => setLocModal({ open: true, rowKey: r.key })}
              >
                创建新仓位
              </Button>
            </>
          )}
        />
      ),
    },
    { title: "操作", width: 60, render: (_, r) => <Button size="small" danger onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>删</Button> },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <h2 style={{ margin: 0 }}>材料入库</h2>
        <Button type="primary" onClick={() => { setRows([]); setSupplierId(0); setOcrRecordId(0); setOcrBillNo(""); setBillDate(""); setRemark(""); setSubmitTried(false); setOpen(true); }}>新建入库</Button>
        <Button onClick={() => navigate("/ocr/delivery")}>送货单识别入库</Button>
      </Space>
      <DataTable
        rowKey="id"
        loading={loading}
        columns={billColumns}
        dataSource={list}
        pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
        rowSelection
        onBatchDelete={async (keys) => {
          for (const k of keys) await purchaseApi.void(Number(k));
          message.success(`已作废 ${keys.length} 张入库单`);
          void load();
        }}
      />

      <BillDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="入库详情"
        statusTag={detail ? <Tag color={detail.status === 1 ? "green" : "default"}>{detail.status === 1 ? "已入库" : "已作废"}</Tag> : undefined}
        fields={[
          { label: "单号", value: detail?.bill_no },
          { label: "仓库", value: detail?.warehouse_name },
          { label: "供应商", value: detail?.supplier_name },
          { label: "入库日期", value: detail?.bill_date?.slice(0, 16) },
          { label: "总数量", value: detail?.total_qty },
          { label: "总金额", value: detail?.total_amount },
          { label: "送货单OCR", value: detail?.ocr_record_id ? `已关联（#${detail.ocr_record_id}）` : "手工录入", span: 2 },
          { label: "备注", value: detail?.remark, span: 2 },
        ]}
        columns={[
          { title: "材料", dataIndex: "product_name", render: (v, r) => <div><b>{v}</b><div style={{ fontSize: 11, color: "#86909c" }}>{r.code}{r.spec ? ` / ${r.spec}` : ""}</div></div> },
          { title: "库位", dataIndex: "location_code", width: 120 },
          { title: "数量", dataIndex: "qty", width: 90, align: "right" as const },
          { title: "单价", dataIndex: "price", width: 90, align: "right" as const },
          { title: "金额", dataIndex: "amount", width: 100, align: "right" as const },
        ]}
        rows={(detail?.items ?? []).map((it) => ({ ...it, key: it.id ?? it.product_id ?? Math.random() }))}
      />

      {/* ===== 新建入库：表头 + 可编辑明细表格 ===== */}
      <Modal title="新建入库" open={open} onOk={() => void create()} onCancel={() => setOpen(false)} width="min(1180px, calc(100vw - 48px))" destroyOnHidden>
        <div style={{ padding: 12, border: "1px solid #e5e6eb", borderRadius: 8, background: "#fafbfc", marginBottom: 12 }}>
          <Space wrap>
            <span>入库仓库</span>
            <Select style={{ width: 180 }} placeholder="选择" options={warehouses} fieldNames={{ label: "name", value: "id" }} value={warehouseId} onChange={(v) => { setWarehouseId(v); void loadLocs(v); }} />
            <span>供应商</span>
            <Select style={{ width: 190 }} placeholder="可选" allowClear options={supplierOptions} value={supplierId || undefined} onChange={(v) => setSupplierId(v ?? 0)} />
            <span>入库日期</span>
            <DatePicker value={billDate ? dayjs(billDate) : undefined} onChange={(d) => setBillDate(d ? d.format("YYYY-MM-DDTHH:mm:ss") : "")} placeholder="默认今天" />
            <span>备注</span>
            <Input style={{ width: 150 }} placeholder="可选" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={255} />
            {ocrBillNo && <Tag color="blue">送货单：{ocrBillNo}</Tag>}
          </Space>
        </div>
        <DataTable
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: "暂无明细" }}
          scroll={{ x: 1300 }}
          footer={() => (
            <Space wrap>
              <Button size="small" onClick={addEmptyRow}>+ 添加明细</Button>
              <span style={{ color: "#86909c", fontSize: 12 }}>
                表头右侧可拖拽调整列宽；条码/名称列支持相机识别；名称未匹配自动大模型兜底分析；合计金额：{rows.reduce((s, r) => s + (r.qty > 0 ? r.qty * (r.price || 0) : 0), 0).toFixed(2)}
              </span>
            </Space>
          )}
        />
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void handleCameraFile(e.target.files?.[0]); e.target.value = ""; }} />
      </Modal>

      {/* 创建新仓位：库位下拉找不到目标仓位时直接新增并选中 */}
      <Modal
        title="创建新仓位"
        open={Boolean(locModal)}
        onOk={() => void createLocationNow()}
        confirmLoading={locSaving}
        onCancel={() => { setLocModal(null); locForm.resetFields(); }}
        width={440}
        destroyOnHidden
      >
        <p style={{ color: "#86909c", fontSize: 12, marginTop: 0 }}>
          新仓位将立即保存并选中当前明细行；编码自动生成（仓库编码-货架编码-层号）。
        </p>
        <Form form={locForm} layout="vertical">
          <Form.Item name="shelf_id" label="所属货架" rules={[{ required: true, message: "请选择货架" }]}>
            <Select
              placeholder="选择货架"
              options={shelves.map((s) => ({ value: s.id, label: `${s.code}${s.name ? ` ${s.name}` : ""}` }))}
              notFoundContent={shelves.length === 0 ? "该仓库暂无货架，请先在「仓库与货架」中创建" : "无匹配货架"}
            />
          </Form.Item>
          <Form.Item name="layer_no" label="层号" rules={[{ required: true, message: "请输入层号" }]}>
            <InputNumber min={1} max={99} style={{ width: "100%" }} placeholder="如 1（1-99）" />
          </Form.Item>
          <Form.Item name="remark" label="备注（可选）">
            <Input placeholder="可空" maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 无材料新增（条码/OCR 未匹配） */}
      <Modal title="材料不存在，是否新增材料？" open={materialModal.open} onOk={() => void createMaterial()} onCancel={() => setMaterialModal((s) => ({ ...s, open: false }))} width={480} destroyOnHidden>
        <p style={{ color: "#86909c", fontSize: 12, marginTop: 0 }}>系统未匹配到该条码/名称对应的材料，确认信息后新增（条码可选），保存后自动带入当前明细行。</p>
        <Form form={materialForm} layout="vertical">
          <Form.Item name="name" label="材料名称" rules={[{ required: true, message: "请输入材料名称" }]} initialValue={materialModal.name}>
            <Input placeholder="如：轴承6204" maxLength={100} />
          </Form.Item>
          <Form.Item name="barcode" label="条码（可选）" initialValue={materialModal.barcode}>
            <Input placeholder="识别到的条码" maxLength={50} />
          </Form.Item>
          <Form.Item name="spec" label="型号规格（可选）" initialValue={materialModal.spec}>
            <Input placeholder="如：20x12" maxLength={100} />
          </Form.Item>
          <Form.Item name="unit_id" label="基本单位" rules={[{ required: true, message: "请选择单位" }]}>
            <Select placeholder="选择" options={units} fieldNames={{ label: "name", value: "id" }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 大模型兜底分析结果确认 */}
      <Modal
        title="大模型分析结果"
        open={Boolean(llmModal)}
        onOk={() => void acceptLlmSuggestion()}
        onCancel={() => setLlmModal(null)}
        okText="按分析新增材料"
        cancelText="取消"
        width={460}
      >
        {llmModal && (
          <>
            <p style={{ fontSize: 13 }}>
              未匹配到系统材料，大模型分析建议：<b>{llmModal.name}</b>
              {llmModal.spec ? `（规格：${llmModal.spec}）` : ""}。确认后自动新增并带入明细。
            </p>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span>基本单位</span>
              <Select
                style={{ width: 200 }}
                placeholder="选择单位"
                options={units}
                fieldNames={{ label: "name", value: "id" }}
                value={llmModal.unitId ?? units[0]?.id}
                onChange={(v) => setLlmModal((m) => (m ? { ...m, unitId: v } : m))}
              />
            </div>
          </>
        )}
      </Modal>

      {/* 材料历史采购价 */}
      <Drawer title={histTitle} open={histOpen} onClose={() => setHistOpen(false)} size={560}>
        <DataTable
          rowKey="bill_no"
          size="small"
          loading={histLoading}
          locale={{ emptyText: "暂无历史采购记录" }}
          pagination={false}
          columns={[
            { title: "入库单号", dataIndex: "bill_no" },
            { title: "日期", dataIndex: "bill_date", render: (v: string) => v?.slice(0, 10) },
            { title: "单价", dataIndex: "price" },
            { title: "数量", dataIndex: "qty" },
            { title: "金额", dataIndex: "amount" },
            { title: "供应商", dataIndex: "supplier_name" },
          ]}
          dataSource={histRows}
        />
      </Drawer>
    </div>
  );
}
