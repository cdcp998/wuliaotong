/** 基础资料接口（商品/仓库/库位，出入库表单用）。 */
import { http, type PageData } from "./client";

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
  status: number;
}

export interface Location {
  id: number;
  warehouse_id: number;
  shelf_id: number;
  layer_no: number;
  code: string;
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
}

export interface Shelf {
  id: number;
  warehouse_id: number;
  code: string;
  name: string;
}

export const baseApi = {
  products: (keyword = "", page = 1, extra?: { barcode?: string; status?: number; pageSize?: number }) => {
    const p = new URLSearchParams({ keyword, page: String(page), page_size: String(extra?.pageSize ?? 20) });
    if (extra?.barcode) p.set("barcode", extra.barcode);
    if (extra?.status !== undefined) p.set("status", String(extra.status));
    return http.get<PageData<Product>>(`/products?${p.toString()}`);
  },
  product: (id: number) => http.get<Product>(`/products/${id}`),
  createProduct: (body: ProductInput) => http.post<Product>("/products", body),
  updateProduct: (id: number, body: ProductInput) => http.put<null>(`/products/${id}`, body),
  deleteProduct: (id: number) => http.delete<null>(`/products/${id}`),
  warehouses: () => http.get<Warehouse[]>("/warehouses"),
  createWarehouse: (body: { code: string; name: string; address?: string; remark?: string }) =>
    http.post<{ id: number; code: string }>("/warehouses", body),
  updateWarehouse: (id: number, body: { name?: string; address?: string; remark?: string; status?: number }) =>
    http.put<null>(`/warehouses/${id}`, body),
  deleteWarehouse: (id: number) => http.delete<null>(`/warehouses/${id}`),
  shelves: (warehouseId: number) => http.get<Shelf[]>(`/warehouses/${warehouseId}/shelves`),
  createShelf: (body: { warehouse_id: number; code: string; name?: string; remark?: string }) =>
    http.post<{ id: number; code: string }>("/shelves", body),
  updateShelf: (id: number, body: { name?: string; remark?: string }) => http.put<null>(`/shelves/${id}`, body),
  deleteShelf: (id: number) => http.delete<null>(`/shelves/${id}`),
  locations: (warehouseId: number) =>
    http.get<Location[]>(`/locations?warehouse_id=${warehouseId}`),
  createLocation: (body: { warehouse_id: number; shelf_id: number; layer_no: number; remark?: string }) =>
    http.post<{ id: number; code: string }>("/locations", body),
  deleteLocation: (id: number) => http.delete<null>(`/locations/${id}`),
  units: () => http.get<Unit[]>("/units"),
  createUnit: (body: { name: string; remark?: string }) => http.post<Unit>("/units", body),
  updateUnit: (id: number, body: { name: string; remark?: string }) => http.put<null>(`/units/${id}`, body),
  deleteUnit: (id: number) => http.delete<null>(`/units/${id}`),
  categories: () => http.get<CategoryNode[]>("/categories"),
  createCategory: (body: { parent_id: number; name: string; sort?: number }) => http.post<CategoryNode>("/categories", body),
  updateCategory: (id: number, body: { parent_id: number; name: string; sort?: number }) => http.put<null>(`/categories/${id}`, body),
  deleteCategory: (id: number) => http.delete<null>(`/categories/${id}`),
  /** 材料查重扫描：名称精确重复 + DeepSeek 判断相似候选 → 疑似重复分组（仅建议，不落库）。 */
  dedupeScan: () => http.post<{ groups: { group: { product_id: number; name: string; spec: string; material_code: string; unit_name: string }[]; reason: string; confidence: string }[] }>("/products/dedupe-scan"),
  /** 人工标记材料为重复（写 remark，不物理删除）。 */
  markDuplicate: (id: number) => http.post<null>(`/products/${id}/mark-duplicate`),
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
