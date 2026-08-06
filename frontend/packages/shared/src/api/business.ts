/** 出入库/盘点接口（仓管员手机端）。 */
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
  create: (from: number, to: number, items: { product_id: number; qty: string; from_location_id: number; to_location_id: number }[], remark = "") =>
    http.post<{ id: number; bill_no: string }>("/transfers", { from_warehouse_id: from, to_warehouse_id: to, remark, items }),
  audit: (id: number) => http.post<null>(`/transfers/${id}/audit`),
  void: (id: number) => http.post<null>(`/transfers/${id}/void`),
};

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
  create: (ioType: string, warehouseId: number, items: { product_id: number; qty: string; location_id: number }[], remark = "") =>
    http.post<{ id: number; bill_no: string }>("/other-io", { io_type: ioType, warehouse_id: warehouseId, remark, items }),
  void: (id: number) => http.post<null>(`/other-io/${id}/void`),
};

export interface RequisitionBill {
  id: number;
  bill_no: string;
  warehouse_name: string;
  use_location: string;
  use_reason: string;
  status: number;
  audit_remark: string;
  created_at: string;
  items: { id: number; product_name: string; qty: string }[];
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
