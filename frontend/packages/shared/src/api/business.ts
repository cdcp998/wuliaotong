/** 出入库/盘点/OCR 接口。 */
import { http, type PageData } from "./client";

export interface InboundItem {
  product_id: number;
  qty: string;
  price: string;
  location_id: number;
  photo_file_id?: number;
  category_id?: number; // 大模型识别/人工确认的材料分类（>0 时入库同步更新材料分类）
}

/** 新建入库：warehouseId 仓库（表头）+ items 明细；supplierId/billDate/remark 为单据表头（标题行）信息。 */
export function purchaseIn(
  warehouseId: number,
  items: InboundItem[],
  remark = "",
  supplierId = 0,
  billDate?: string,
  ocrRecordId = 0
) {
  return http.post<{ id: number; bill_no: string }>("/purchase-in", {
    warehouse_id: warehouseId,
    supplier_id: supplierId,
    bill_date: billDate,
    remark,
    ocr_record_id: ocrRecordId,
    items,
  });
}

export interface OtherIoItem {
  product_id: number;
  qty: string;
  location_id: number;
  photo_file_id?: number;
}

export function otherIo(ioType: string, warehouseId: number, items: OtherIoItem[], remark = "") {
  return http.post<{ id: number; bill_no: string }>("/other-io", {
    io_type: ioType,
    warehouse_id: warehouseId,
    remark,
    items,
  });
}

export interface CheckItem {
  id: number;
  product_id: number;
  product_name: string;
  code: string;
  material_code: string;
  spec: string;
  unit_name: string;
  category_name: string;
  location_code: string;
  book_qty: string;
  real_qty: string | null;
  diff_qty: string;
  photo_file_id: number;
}

export interface CheckBill {
  id: number;
  bill_no: string;
  warehouse_name: string;
  status: number;
  check_date: string;
  items: CheckItem[];
}

export const checkApi = {
  list: (status?: number, page = 1, pageSize = 20) =>
    http.get<PageData<CheckBill>>(
      `/checks${status ? `?status=${status}` : ""}${status ? "&" : "?"}page=${page}&page_size=${pageSize}`
    ),
  detail: (id: number) => http.get<CheckBill>(`/checks/${id}`),
  create: (warehouseId: number, remark = "") => http.post<{ id: number; bill_no: string }>("/checks", { warehouse_id: warehouseId, remark }),
  saveItems: (id: number, items: { check_item_id: number; real_qty: string; photo_file_id?: number; product_id?: number }[]) =>
    http.put<null>(`/checks/${id}/items`, { items }),
  audit: (id: number) => http.post<null>(`/checks/${id}/audit`),
  /** 导出盘点结果 Excel（收发存模板格式 + 盘点字段），浏览器直接下载（session cookie 同源）。 */
  exportUrl: (id: number) => `/api/v1/checks/${id}/export`,
};

export interface TransferBill {
  id: number;
  bill_no: string;
  from_warehouse_name: string;
  to_warehouse_name: string;
  status: number;
  audit_name: string;
  created_at: string;
}

export const transferApi = {
  list: (status?: number, page = 1, pageSize = 20) =>
    http.get<PageData<TransferBill>>(
      `/transfers${status !== undefined ? `?status=${status}` : ""}${status !== undefined ? "&" : "?"}page=${page}&page_size=${pageSize}`
    ),
  detail: (id: number) => http.get<TransferDetail>(`/transfers/${id}`),
  create: (from: number, to: number, items: { product_id: number; qty: string; from_location_id: number; to_location_id: number }[], remark = "") =>
    http.post<{ id: number; bill_no: string }>("/transfers", { from_warehouse_id: from, to_warehouse_id: to, remark, items }),
  audit: (id: number) => http.post<null>(`/transfers/${id}/audit`),
  reject: (id: number) => http.post<null>(`/transfers/${id}/reject`),
  void: (id: number) => http.post<null>(`/transfers/${id}/void`),
};

export interface TransferDetail {
  id: number;
  bill_no: string;
  from_warehouse_name: string;
  to_warehouse_name: string;
  status: number;
  audit_name: string;
  audit_time: string | null;
  remark: string;
  created_at: string;
  items: {
    id: number;
    product_id: number;
    product_name: string;
    code: string;
    qty: string;
    from_location_code: string;
    to_location_code: string;
  }[];
}

export interface OtherIoBill {
  id: number;
  bill_no: string;
  warehouse_name: string;
  io_type: string;
  status: number;
  operator_name: string;
  created_at: string;
}

export const otherIoApi = {
  list: (ioType?: string, status?: number, page = 1, pageSize = 20) =>
    http.get<PageData<OtherIoBill>>(
      `/other-io?page=${page}&page_size=${pageSize}${ioType ? `&io_type=${encodeURIComponent(ioType)}` : ""}${status !== undefined ? `&status=${status}` : ""}`
    ),
  detail: (id: number) => http.get<OtherIoDetail>(`/other-io/${id}`),
  create: (ioType: string, warehouseId: number, items: { product_id: number; qty: string; location_id: number }[], remark = "") =>
    http.post<{ id: number; bill_no: string }>("/other-io", { io_type: ioType, warehouse_id: warehouseId, remark, items }),
  void: (id: number) => http.post<null>(`/other-io/${id}/void`),
};

export interface OtherIoDetail {
  id: number;
  bill_no: string;
  warehouse_name: string;
  io_type: string;
  status: number;
  operator_name: string;
  remark: string;
  created_at: string;
  items: BillItem[];
}

export interface RequisitionBill {
  id: number;
  bill_no: string;
  applicant_name: string;
  warehouse_name: string;
  use_location: string;
  use_reason: string;
  is_private: number;
  display_reason: string;
  display_location: string;
  work_photo_file_id: number;
  work_done_at: string | null;
  work_lat: string;
  work_lng: string;
  total_qty: string;
  status: number;
  audit_remark: string;
  created_at: string;
  items: { id: number; product_name: string; qty: string }[];
}

export interface RequisitionDetail extends RequisitionBill {
  applicant_id: number;
  applicant_name: string;
  location_photo_file_id: number;
  warehouse_id: number;
  total_qty: string;
  audit_by: number;
  audit_name: string;
  audit_time: string;
  remark: string;
  items: {
    id: number;
    product_id: number;
    product_name: string;
    code: string;
    spec: string;
    location_id: number;
    location_code: string;
    qty: string;
    photo_file_id: number;
  }[];
}

export const requisitionApi = {
  create: (
    warehouseId: number,
    useLocation: string,
    useReason: string,
    items: { product_id: number; qty: string; location_id: number; photo_file_id?: number }[],
    remark = "",
    isPrivate = 0,
    applicantId = 0
  ) =>
    http.post<{ id: number; bill_no: string }>("/requisitions", {
      warehouse_id: warehouseId,
      use_location: useLocation,
      use_reason: useReason,
      is_private: isPrivate,
      applicant_id: applicantId,
      remark,
      items,
    }),
  /** 可选申请人列表：管理员（代申请）返回全部启用使用者；普通使用者仅返回自己。 */
  applicants: () => http.get<{ id: number; real_name: string; username?: string }[]>("/requisitions/applicants"),
  my: (status?: number, page = 1) =>
    http.get<PageData<RequisitionBill>>(
      `/requisitions/my${status ? `?status=${status}` : ""}${status ? "&" : "?"}page=${page}&page_size=20`
    ),
  list: (status?: number, page = 1, keyword = "", pageSize = 20) =>
    http.get<PageData<RequisitionBill>>(
      `/requisitions${status !== undefined ? `?status=${status}&` : "?"}page=${page}&page_size=${pageSize}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""}`
    ),
  audit: (id: number, action: "approve" | "reject", remark: string) =>
    http.post<null>(`/requisitions/${id}/audit`, { action, remark }),
  detail: (id: number) => http.get<RequisitionDetail>(`/requisitions/${id}`),
  cancel: (id: number) => http.post<null>(`/requisitions/${id}/cancel`),
  /** 完成工作：在工作地点拍照留痕（手机定位供下载水印），提交后进入待审计。 */
  workDone: (id: number, photoFileId: number, lat = "", lng = "") =>
    http.post<null>(`/requisitions/${id}/work-done`, { photo_file_id: photoFileId, lat, lng }),
  /** 下载完成工作照片（下载时动态添加地点/时间/定位水印，原图不保存水印）。 */
  workPhotoUrl: (id: number) => `/api/v1/requisitions/${id}/work-photo`,
  /** 管理员编辑私用申请的对外显示信息（掩护值，固定展示给非管理员）。 */
  updateDisplay: (id: number, displayReason: string, displayLocation: string) =>
    http.put<null>(`/requisitions/${id}/display`, {
      display_reason: displayReason,
      display_location: displayLocation,
    }),
  /** 管理员编辑领用单的 GPS 坐标与地点信息（水印/记录用）。 */
  updateWorkLocation: (id: number, useLocation: string, lat: string, lng: string) =>
    http.put<null>(`/requisitions/${id}/work-location`, { use_location: useLocation, lat, lng }),
};

export const fileApi = {
  upload: async (file: File, bizType = "other"): Promise<{ file_id: number; url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/v1/files/upload?biz_type=${bizType}`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message);
    return json.data;
  },
  /** 真实照片水印预览（完成工作拍照提交前）：按当前系统模板/位置渲染，返回 blob URL。 */
  watermarkPreview: async (fileId: number, body: { location?: string; time?: string; lat?: string; lng?: string }) => {
    const resp = await fetch(`/api/v1/files/${fileId}/watermark-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error("预览生成失败");
    return URL.createObjectURL(await resp.blob());
  },
};

export interface OcrLine {
  text: string;
  score?: number;
}

export interface OcrDeliveryItem {
  product_name: string;
  material_code?: string;
  spec?: string;
  unit?: string;
  qty?: string;
  price?: string;
  amount?: string;
}

export interface OcrTask {
  status: "running" | "done" | "failed";
  record_id: number;
  structured: {
    lines?: string[];
    supplier_name?: string;
    bill_no?: string;
    _engine?: "template" | "deepseek";
    items?: OcrDeliveryItem[];
  } | null;
  error?: string;
}

export interface OcrQuickResult {
  lines: string[];
  record_id: number;
  matches: { product_id: number; code: string; name: string; spec: string }[];
}

/** 送货单确认：供应商落库 + 物料自动匹配/新增 + 识别记录回写（《后端API设计.md》§7）。 */
export interface DeliveryConfirmInput {
  record_id?: number;
  supplier_name?: string;
  bill_no?: string;
  items: OcrDeliveryItem[];
}

/** 确认返回：items 含 product_id（物料自动匹配/新增结果），created_products 为本次新建的物料；supplier_created 表示供应商本次自动创建。 */
export interface DeliveryConfirmResult {
  supplier_id: number;
  supplier_name: string;
  supplier_created?: boolean;
  bill_no: string;
  record_id: number;
  items: (OcrDeliveryItem & { product_id: number; _created?: boolean })[];
  created_products?: (OcrDeliveryItem & { product_id: number })[];
}

export const ocrApi = {
  /** 识别方式：auto 模板优先+大模型兜底 / template 仅本地模板（秒级） / llm 仅大模型（30-60 秒） */
  recognize: (fileId: number, ocrType: 1 | 2 | 3, mode: "auto" | "template" | "llm" = "auto") =>
    http.post<{ task_id: string }>(`/ocr/recognize?file_id=${fileId}&ocr_type=${ocrType}&mode=${mode}`),
  taskStatus: (taskId: string) => http.get<OcrTask>(`/ocr/tasks/${taskId}`),
  quick: (fileId: number, ocrType: 2 | 3) =>
    http.post<OcrQuickResult>(`/ocr/quick?file_id=${fileId}&ocr_type=${ocrType}`),
  decodeBarcode: (fileId: number) => http.post<{ barcode: string }>(`/barcode/decode?file_id=${fileId}`),
  /** 材料分类识别：根据名称+规格用大模型判断系统分类（入库明细行「分类」自动识别）。 */
  classifyProduct: (body: { name: string; spec: string }) =>
    http.post<{ category_id: number; category_name: string; matched: boolean }>("/ocr/classify", body),
  deliveryConfirm: (body: DeliveryConfirmInput) =>
    http.post<DeliveryConfirmResult>("/ocr/delivery/confirm", body),
  records: (matchStatus?: number, page = 1) =>
    http.get<PageData<Record<string, unknown>>>(
      `/ocr/records${matchStatus !== undefined ? `?match_status=${matchStatus}` : ""}${matchStatus !== undefined ? "&" : "?"}page=${page}&page_size=20`
    ),
  match: (recordId: number) =>
    http.post<{ suggestion_id: number; product_name: string; detail: Record<string, unknown> }>(`/ocr/match?record_id=${recordId}`),
};

export interface AiSuggestion {
  id: number;
  ocr_record_id: number;
  product_name: string;
  model: string;
  suggestion: { spec?: string; category?: string; note?: string } | null;
  status: number;
  new_product_id: number;
  created_at: string;
}

export const aiApi = {
  list: (status = 1, page = 1, pageSize = 20) =>
    http.get<PageData<AiSuggestion>>(`/ai-suggestions?status=${status}&page=${page}&page_size=${pageSize}`),
  accept: (id: number, params: { code?: string; name?: string; category_id?: number; unit_id?: number; purchase_price?: string }) =>
    http.post<{ product_id: number; code: string }>(
      `/ai-suggestions/${id}/accept?${new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])
      )}`
    ),
  ignore: (id: number) => http.post<null>(`/ai-suggestions/${id}/ignore`),
};

export interface PurchaseInBill {
  id: number;
  bill_no: string;
  supplier_name: string;
  warehouse_name: string;
  status: number;
  bill_date: string;
  total_qty: string;
  total_amount: string;
}

export interface BillItem {
  id?: number;
  product_id?: number;
  product_name: string;
  code: string;
  spec: string;
  location_code: string;
  qty: string;
  price?: string;
  amount?: string;
  photo_file_id?: number;
}

export interface PurchaseInDetail extends PurchaseInBill {
  remark: string;
  operator_name?: string;
  ocr_record_id?: number;
  items: BillItem[];
}

/** 历史采购价行（材料/供应商历史价格查询）。 */
export interface HistoryPriceRow {
  bill_no: string;
  bill_date: string;
  price: string;
  qty: string;
  amount: string;
  supplier_id: number;
  supplier_name: string;
  unit_name: string;
  product_id: number;
  product_name: string;
  material_code: string;
  spec: string;
}

export const purchaseApi = {
  list: (page = 1, pageSize = 20) => http.get<PageData<PurchaseInBill>>(`/purchase-in?page=${page}&page_size=${pageSize}`),
  detail: (id: number) => http.get<PurchaseInDetail>(`/purchase-in/${id}`),
  void: (id: number) => http.post<null>(`/purchase-in/${id}/void`),
  historyPrice: (params: { productId?: number; supplierId?: number; keyword?: string; page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams({
      product_id: String(params.productId ?? 0),
      supplier_id: String(params.supplierId ?? 0),
      page: String(params.page ?? 1),
      page_size: String(params.pageSize ?? 20),
    });
    if (params.keyword) p.set("keyword", params.keyword);
    return http.get<PageData<HistoryPriceRow>>(`/purchase-in/history-price?${p.toString()}`);
  },
};

/** 库存查询（《后端API设计.md》§6 /stock）。 */
export interface StockRow {
  product_id: number;
  product_name: string;
  code: string;
  material_code: string;
  barcode: string;
  spec: string;
  warehouse_id: number;
  warehouse_name: string;
  location_id: number;
  location_code: string;
  qty: string;
  cost_price: string;
  amount: string;
}

export interface StockFlowRow {
  id: number;
  product_id: number;
  product_name: string;
  warehouse_name: string;
  location_code: string;
  change_type: string;
  bill_type: string;
  bill_no: string;
  before_qty: string;
  change_qty: string;
  after_qty: string;
  operator_name: string;
  remark: string;
  created_at: string;
}

export const stockApi = {
  query: (params: { keyword?: string; warehouse_id?: number; location_id?: number; product_id?: number; page?: number; page_size?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.keyword) qs.set("keyword", params.keyword);
    if (params.warehouse_id) qs.set("warehouse_id", String(params.warehouse_id));
    if (params.location_id) qs.set("location_id", String(params.location_id));
    if (params.product_id) qs.set("product_id", String(params.product_id));
    qs.set("page", String(params.page ?? 1));
    qs.set("page_size", String(params.page_size ?? 20));
    return http.get<PageData<StockRow>>(`/stock?${qs}`);
  },
  flow: (params: { product_id?: number; bill_no?: string; change_type?: string; page?: number; page_size?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.product_id) qs.set("product_id", String(params.product_id));
    if (params.bill_no) qs.set("bill_no", params.bill_no);
    if (params.change_type) qs.set("change_type", params.change_type);
    qs.set("page", String(params.page ?? 1));
    qs.set("page_size", String(params.page_size ?? 20));
    return http.get<PageData<StockFlowRow>>(`/stock/flow?${qs}`);
  },
};
