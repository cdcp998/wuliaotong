/** 报表/看板/2D 货架图接口（P6，对应《后端API设计.md》§6、§8）。 */
import { apiBase, http, type PageData } from "./client";

export interface TrendPoint {
  date: string;
  in_qty: string;
  out_qty: string;
}

export interface StockSummary {
  sku_count: number;
  total_qty: string;
  today_in_qty: string;
  today_out_qty: string;
  alert_count: number;
  pending_requisition_count: number;
  trend_7d: TrendPoint[];
}

export interface DashboardData {
  today: { in_qty: string; out_qty: string };
  week: { in_qty: string; out_qty: string };
  month: { in_qty: string; out_qty: string };
  sku_count: number;
  total_qty: string;
  alert_count: number;
  todos: { pending_requisitions: number; pending_transfers: number; pending_checks: number };
  trend_7d: TrendPoint[];
}

export interface InventorySummaryRow {
  product_id: number;
  code: string;
  name: string;
  spec: string;
  unit_name: string;
  opening_qty: string;
  in_qty: string;
  out_qty: string;
  closing_qty: string;
  closing_amount: string;
}

export interface StockReportRow {
  product_id: number;
  code: string;
  name: string;
  spec: string;
  warehouse_name: string;
  qty: string;
  cost_price: string;
  amount: string;
  out_qty_30d: string;
  last_moved_at: string;
  dormant_days: number;
}

export interface LocationStock {
  location_id: number;
  location_code: string;
  layer_no: number;
  items: {
    product_id: number;
    code: string;
    name: string;
    spec: string;
    qty: string;
    min_stock: string;
    max_stock: string;
    alert: "low" | "high" | "normal";
  }[];
}

export const reportApi = {
  stockSummary: () => http.get<StockSummary>("/stock/summary"),
  dashboard: () => http.get<DashboardData>("/reports/dashboard"),
  /** AI 月报摘要（P9-P1⑦）：服务端聚合+DeepSeek 生成经营摘要。 */
  aiSummary: (start: string, end: string) => http.post<{ summary: string; ai: boolean }>("/reports/ai-summary", { start, end }),
  inventorySummary: (params: { warehouse_id?: number; product_id?: number; start?: string; end?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams();
    if (params.warehouse_id) q.set("warehouse_id", String(params.warehouse_id));
    if (params.product_id) q.set("product_id", String(params.product_id));
    if (params.start) q.set("start", params.start);
    if (params.end) q.set("end", params.end);
    q.set("page", String(params.page ?? 1));
    q.set("page_size", String(params.page_size ?? 20));
    return http.get<PageData<InventorySummaryRow>>(`/reports/inventory-summary?${q}`);
  },
  stock: (params: { warehouse_id?: number; sort?: "qty" | "amount" | "turnover"; page?: number; page_size?: number }) => {
    const q = new URLSearchParams();
    if (params.warehouse_id) q.set("warehouse_id", String(params.warehouse_id));
    q.set("sort", params.sort ?? "qty");
    q.set("page", String(params.page ?? 1));
    q.set("page_size", String(params.page_size ?? 20));
    return http.get<PageData<StockReportRow>>(`/reports/stock?${q}`);
  },
  locationSummary: (warehouseId: number, shelfId?: number) =>
    http.get<LocationStock[]>(`/stock/location-summary?warehouse_id=${warehouseId}${shelfId ? `&shelf_id=${shelfId}` : ""}`),
};

/** 报表导出：浏览器直接下载（session cookie 同源）。 */
export function exportReportUrl(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  return `${apiBase()}/reports/export?${q}`;
}
