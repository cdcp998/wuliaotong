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
  status: number;
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
}

export interface CategoryNode {
  id: number;
  parent_id: number;
  name: string;
  children?: CategoryNode[];
}

export interface Shelf {
  id: number;
  warehouse_id: number;
  code: string;
  name: string;
}

export const baseApi = {
  products: (keyword: string, page = 1) =>
    http.get<PageData<Product>>(`/products?keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=20`),
  product: (id: number) => http.get<Product>(`/products/${id}`),
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
  categories: () => http.get<CategoryNode[]>("/categories"),
};
