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
  saveItems: (id: number, items: { check_item_id: number; real_qty: string; photo_file_id?: number }[]) =>
    http.put<null>(`/checks/${id}/items`, { items }),
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
