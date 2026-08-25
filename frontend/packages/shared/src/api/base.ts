/** 基础资料接口（商品/仓库/库位，出入库表单用）。 */
import { apiBase, BizError, http, type ApiResponse, type PageData } from "./client";

export interface Product {
  id: number;
  code: string;
  material_code: string;
  barcode: string;
  name: string;
  spec: string;
  unit_name: string;
  unit_id: number;
  category_id: number;
  category_name: string;
  purchase_price: string;
  min_stock: string;
  max_stock: string;
  status: number;
  remark: string;
  supplier_ids: number[];
  supplier_names: string[];
  created_at?: string;
  /** 全仓库存合计（仅 /products?category_id= 查询返回；分类管理挂载材料表格的「数量」列） */
  stock_qty?: string;
}

/** 删除审核申请（物料数据/故障删除审批流：提交/查询/通过/驳回）。 */
export interface DeleteReview {
  id: number;
  biz_type: "product" | "category" | "fault";
  target_id: number;
  target_name: string;
  target_desc: string;
  reason: string;
  status: number; // 0 待审核 / 1 已通过（已删除） / 2 已驳回
  applicant_id: number;
  applicant_name: string;
  handled_by: number;
  handled_at: string | null;
  review_remark: string;
  created_at: string | null;
}

/** 新建/编辑材料入参（与后端 ProductReq 对应）。 */
export interface ProductInput {
  code?: string;
  material_code?: string;
  barcode?: string;
  sku?: string;
  name: string;
  category_id?: number;
  spec?: string;
  unit_id: number;
  purchase_price?: string;
  min_stock?: string;
  max_stock?: string;
  remark?: string;
  status?: number;
  /** 关联供应商；编辑时缺省保持原关联，传 [] 清空。 */
  supplier_ids?: number[];
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  address: string;
  status: number;
  /** 聚合（仓库与货架页列表展示）。 */
  shelf_count?: number;
  location_count?: number;
  product_kind_count?: number;
}

export interface Location {
  id: number;
  warehouse_id: number;
  shelf_id: number;
  layer_no: number;
  row_no: number;
  col_no: number;
  code: string;
  /** 友好库位名：仓库名-货架编码-L{层}R{行}C{列}（如「一号仓-A01-L1R1C1」；界面显示用）。 */
  display?: string;
}

export interface Unit {
  id: number;
  name: string;
  remark?: string;
}

export interface CategoryNode {
  id: number;
  parent_id: number;
  name: string;
  sort?: number;
  children?: CategoryNode[];
  /** 已挂启用材料数（/categories 实时统计；材料只挂二级分类，顶级分类该值为 0）。 */
  product_count?: number;
}

export interface Shelf {
  id: number;
  warehouse_id: number;
  code: string;
  name: string;
  /** 实际维度（由库位推导，2.5D 视图布局用）。 */
  layers?: number;
  rows?: number;
  cols?: number;
}

export const baseApi = {
  products: (keyword = "", page = 1, extra?: { barcode?: string; status?: number; pageSize?: number; ai?: number; categoryId?: number; descendants?: number; uncategorized?: number }) => {
    const p = new URLSearchParams({ keyword, page: String(page), page_size: String(extra?.pageSize ?? 20) });
    if (extra?.barcode) p.set("barcode", extra.barcode);
    if (extra?.status !== undefined) p.set("status", String(extra.status));
    if (extra?.ai !== undefined) p.set("ai", String(extra.ai));
    if (extra?.categoryId) p.set("category_id", String(extra.categoryId));
    if (extra?.descendants) p.set("descendants", String(extra.descendants));
    if (extra?.uncategorized) p.set("uncategorized", String(extra.uncategorized));
    return http.get<PageData<Product>>(`/products?${p.toString()}`);
  },
  product: (id: number) => http.get<Product>(`/products/${id}`),
  createProduct: (body: ProductInput) => http.post<Product>("/products", body),
  updateProduct: (id: number, body: ProductInput) => http.put<null>(`/products/${id}`, body),
  deleteProduct: (id: number) => http.delete<null>(`/products/${id}`),
  /** 单独更新材料分类（分类管理页「取消挂载/改挂」）：categoryId=0 取消挂载。 */
  updateProductCategory: (id: number, categoryId: number) => http.put<null>(`/products/${id}/category`, { category_id: categoryId }),
  warehouses: () => http.get<Warehouse[]>("/warehouses"),
  createWarehouse: (body: { code: string; name: string; address?: string; remark?: string }) =>
    http.post<{ id: number; code: string }>("/warehouses", body),
  updateWarehouse: (id: number, body: { name?: string; address?: string; remark?: string; status?: number }) =>
    http.put<null>(`/warehouses/${id}`, body),
  deleteWarehouse: (id: number) => http.delete<null>(`/warehouses/${id}`),
  shelves: (warehouseId: number) => http.get<Shelf[]>(`/warehouses/${warehouseId}/shelves`),
  createShelf: (body: { warehouse_id: number; code: string; name?: string; remark?: string; layers?: number; rows?: number; cols?: number }) =>
    http.post<Shelf>("/shelves", body),
  updateShelf: (id: number, body: { name?: string; remark?: string }) => http.put<null>(`/shelves/${id}`, body),
  deleteShelf: (id: number) => http.delete<null>(`/shelves/${id}`),
  locations: (warehouseId: number) =>
    http.get<Location[]>(`/locations?warehouse_id=${warehouseId}`),
  createLocation: (body: { warehouse_id: number; shelf_id: number; layer_no: number; row_no?: number; col_no?: number; remark?: string }) =>
    http.post<Location>("/locations", body),
  deleteLocation: (id: number) => http.delete<null>(`/locations/${id}`),
  units: () => http.get<Unit[]>("/units"),
  createUnit: (body: { name: string; remark?: string }) => http.post<Unit>("/units", body),
  updateUnit: (id: number, body: { name: string; remark?: string }) => http.put<null>(`/units/${id}`, body),
  deleteUnit: (id: number) => http.delete<null>(`/units/${id}`),
  categories: () => http.get<CategoryNode[]>("/categories"),
  createCategory: (body: { parent_id: number; name: string; sort?: number }) => http.post<CategoryNode>("/categories", body),
  updateCategory: (id: number, body: { parent_id: number; name: string; sort?: number }) => http.put<null>(`/categories/${id}`, body),
  deleteCategory: (id: number) => http.delete<null>(`/categories/${id}`),
  /** 材料查重扫描：名称精确重复 + 本地相似规则分组 → 疑似重复分组（仅建议，不落库）。 */
  dedupeScan: () => http.post<{ groups: { group: { product_id: number; name: string; spec: string; material_code: string; unit_name: string }[]; reason: string; confidence: string }[] }>("/products/dedupe-scan"),
  /** 人工标记材料为重复（写 remark，不物理删除）。 */
  markDuplicate: (id: number) => http.post<null>(`/products/${id}/mark-duplicate`),
  /** 提交删除申请（材料停用 / 分类删除；管理者审核通过后才执行）。 */
  submitDeleteReview: (body: { biz_type: "product" | "category" | "fault"; target_id: number; reason: string }) => http.post<DeleteReview>("/delete-reviews", body),
  /** 删除审核列表（status: 0 待审核 / 1 已通过 / 2 已驳回）。 */
  deleteReviews: (status = 0, page = 1, pageSize = 20) =>
    http.get<PageData<DeleteReview>>(`/delete-reviews?status=${status}&page=${page}&page_size=${pageSize}`),
  /** 审核通过并执行删除。 */
  approveDeleteReview: (id: number) => http.post<DeleteReview>(`/delete-reviews/${id}/approve`),
  /** 审核驳回。 */
  rejectDeleteReview: (id: number, remark: string) => http.post<DeleteReview>(`/delete-reviews/${id}/reject`, { remark }),
  suppliers: (status?: number, keyword = "", page = 1, pageSize = 100) => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (status !== undefined) p.set("status", String(status));
    if (keyword) p.set("keyword", keyword);
    return http.get<PageData<Supplier>>(`/suppliers?${p.toString()}`);
  },
  supplierProducts: (id: number) => http.get<{ list: Product[]; total: number }>(`/suppliers/${id}/products`),
  createSupplier: (body: SupplierInput) => http.post<Supplier>("/suppliers", body),
  updateSupplier: (id: number, body: SupplierInput) => http.put<null>(`/suppliers/${id}`, body),
  deleteSupplier: (id: number) => http.delete<null>(`/suppliers/${id}`),
  /** Excel 导入供应商（xlsx：表头 编码/名称/联系人/电话/地址）。 */
  supplierImport: async (file: File): Promise<{ success_count: number; fail_rows: { row: number; reason: string }[] }> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${apiBase()}/suppliers/import`, { method: "POST", credentials: "include", body: fd });
    const j = (await res.json()) as ApiResponse<{ success_count: number; fail_rows: { row: number; reason: string }[] }>;
    if (!res.ok || j.code !== 0) throw new BizError(j.code, j.message);
    return j.data;
  },
};

/** 新建/编辑供应商入参（与后端 SupplierReq 对应）。 */
export interface SupplierInput {
  code: string;
  name: string;
  contact?: string;
  phone?: string;
  address?: string;
  remark?: string;
  status?: number;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  contact: string;
  phone: string;
  address: string;
  remark: string;
  status: number;
  last_supply_at?: string;
}

/** 逆地理编码：GPS 坐标 → 地址（OpenStreetMap，需外网）。 */
export const geoApi = {
  reverse: (lat: string, lng: string) =>
    http.get<{ address: string; short_address: string }>(
      `/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
    ),
};

/** 按条码精确查询启用材料；不存在返回 null（入库扫码「无材料新增」流程用）。 */
export async function resolveByBarcode(barcode: string): Promise<Product | null> {
  const data = await baseApi.products("", 1, { barcode: barcode.trim(), status: 1 });
  return data.list[0] ?? null;
}
