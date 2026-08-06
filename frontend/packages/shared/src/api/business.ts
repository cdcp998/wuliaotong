/** 出入库/盘点/OCR 接口。 */
import { http, type PageData } from "./client";

export interface InboundItem {
  product_id: number;
  qty: string;
  price: string;
  location_id: number;
  photo_file_id?: number;
}

export function purchaseIn(warehouseId: number, items: InboundItem[], remark = "") {
  return http.post<{ id: number; bill_no: string }>("/purchase-in", {
    warehouse_id: warehouseId,
    remark,
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
  list: (status?: number, page = 1) =>
    http.get<PageData<CheckBill>>(
      `/checks${status ? `?status=${status}` : ""}${status ? "&" : "?"}page=${page}&page_size=20`
    ),
  detail: (id: number) => http.get<CheckBill>(`/checks/${id}`),
  create: (warehouseId: number, remark = "") => http.post<{ id: number; bill_no: string }>("/checks", { warehouse_id: warehouseId, remark }),
  saveItems: (id: number, items: { check_item_id: number; real_qty: string; photo_file_id?: number }[]) =>
    http.put<null>(`/checks/${id}/items`, { items }),
  audit: (id: number) => http.post<null>(`/checks/${id}/audit`),
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
  list: (status?: number, page = 1) =>
    http.get<PageData<TransferBill>>(
      `/transfers${status !== undefined ? `?status=${status}` : ""}${status !== undefined ? "&" : "?"}page=${page}&page_size=20`
    ),
  detail: (id: number) => http.get<TransferDetail>(`/transfers/${id}`),
  create: (from: number, to: number, items: { product_id: number; qty: string; from_location_id: number; to_location_id: number }[], remark = "") =>
    http.post<{ id: number; bill_no: string }>("/transfers", { from_warehouse_id: from, to_warehouse_id: to, remark, items }),
  audit: (id: number) => http.post<null>(`/transfers/${id}/audit`),
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
  list: (ioType?: string, status?: number, page = 1) =>
    http.get<PageData<OtherIoBill>>(
      `/other-io?page=${page}&page_size=20${ioType ? `&io_type=${encodeURIComponent(ioType)}` : ""}${status !== undefined ? `&status=${status}` : ""}`
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
    remark = ""
  ) =>
    http.post<{ id: number; bill_no: string }>("/requisitions", {
      warehouse_id: warehouseId,
      use_location: useLocation,
      use_reason: useReason,
      remark,
      items,
    }),
  my: (status?: number, page = 1) =>
    http.get<PageData<RequisitionBill>>(
      `/requisitions/my${status ? `?status=${status}` : ""}${status ? "&" : "?"}page=${page}&page_size=20`
    ),
  list: (status?: number, page = 1) =>
    http.get<PageData<RequisitionBill>>(
      `/requisitions${status !== undefined ? `?status=${status}` : ""}${status !== undefined ? "&" : "?"}page=${page}&page_size=20`
    ),
  audit: (id: number, action: "approve" | "reject", remark: string) =>
    http.post<null>(`/requisitions/${id}/audit`, { action, remark }),
  detail: (id: number) => http.get<RequisitionDetail>(`/requisitions/${id}`),
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
};

export interface OcrLine {
  text: string;
  score?: number;
}

export interface OcrTask {
  status: "running" | "done" | "failed";
  record_id: number;
  structured: { lines?: string[]; items?: { product_name: string; qty?: string; price?: string; amount?: string }[] } | null;
  error?: string;
}

export interface OcrQuickResult {
  lines: string[];
  matches: { product_id: number; code: string; name: string; spec: string }[];
}

export const ocrApi = {
  recognize: (fileId: number, ocrType: 1 | 2 | 3) =>
    http.post<{ task_id: string }>(`/ocr/recognize?file_id=${fileId}&ocr_type=${ocrType}`),
  taskStatus: (taskId: string) => http.get<OcrTask>(`/ocr/tasks/${taskId}`),
  quick: (fileId: number, ocrType: 2 | 3) =>
    http.post<OcrQuickResult>(`/ocr/quick?file_id=${fileId}&ocr_type=${ocrType}`),
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
  list: (status = 1, page = 1) =>
    http.get<PageData<AiSuggestion>>(`/ai-suggestions?status=${status}&page=${page}&page_size=20`),
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
  items: BillItem[];
}

export const purchaseApi = {
  list: (page = 1) => http.get<PageData<PurchaseInBill>>(`/purchase-in?page=${page}&page_size=20`),
  detail: (id: number) => http.get<PurchaseInDetail>(`/purchase-in/${id}`),
  void: (id: number) => http.post<null>(`/purchase-in/${id}/void`),
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
  query: (params: { keyword?: string; warehouse_id?: number; location_id?: number; product_id?: number; page?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.keyword) qs.set("keyword", params.keyword);
    if (params.warehouse_id) qs.set("warehouse_id", String(params.warehouse_id));
    if (params.location_id) qs.set("location_id", String(params.location_id));
    if (params.product_id) qs.set("product_id", String(params.product_id));
    qs.set("page", String(params.page ?? 1));
    qs.set("page_size", "20");
    return http.get<PageData<StockRow>>(`/stock?${qs}`);
  },
  flow: (params: { product_id?: number; bill_no?: string; change_type?: string; page?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.product_id) qs.set("product_id", String(params.product_id));
    if (params.bill_no) qs.set("bill_no", params.bill_no);
    if (params.change_type) qs.set("change_type", params.change_type);
    qs.set("page", String(params.page ?? 1));
    qs.set("page_size", "20");
    return http.get<PageData<StockFlowRow>>(`/stock/flow?${qs}`);
  },
};
