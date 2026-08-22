/** 手机端 cable 模块 API（方案 §6.2 子集）。 */
import { http } from "@wlt/shared";

export interface CableItem {
  id: number;
  code: string;
  name: string;
  type: string;
  total_length: number;
  geometry: { type: string; coordinates: [number, number][] } | null;
  status: number;
}

export interface FaultItem {
  id: number;
  cable_id: number | null;
  lat: number;
  lng: number;
  cumulative_distance: number;
  fault_type: string;
  severity: number;
  description: string;
  status: number;
}

export interface Page<T> {
  total: number;
  items: T[];
}

export const cableApi = {
  list: (params: { status?: string; page_size?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    return http.get<Page<CableItem>>(`/cables?${p.toString()}`);
  },
  faults: (params: { page_size?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    return http.get<Page<FaultItem>>(`/faults?${p.toString()}`);
  },
  createFault: (body: { lat: number; lng: number; fault_type?: string; severity?: number; description?: string }) =>
    http.post<{ id: number }>("/faults", body),
  addFaultPhoto: (id: number, fileId: number) => http.post<{ id: number }>(`/faults/${id}/photos`, { file_id: fileId, category: "现场" }),
  measure: (body: { cable_id: number; distance: number }) =>
    http.post<{ lat: number; lng: number; cumulative_distance: number; total_length: number; nearest_marker: { label: string; distance: number } | null }>("/geo/measure", body),
  navigate: (body: { lat: number; lng: number; fault_id: number; heading?: number }) =>
    http.post<{ straight_distance: number; projection: { lat: number; lng: number; cumulative_distance: number } | null; fault_cumulative: number; remaining_distance: number; path: [number, number][]; candidates: { cable_id: number; cable_name: string }[] }>("/geo/navigate", body),
  nearbyFaults: (lat: number, lng: number, radius = 500) =>
    http.get<{ items: (FaultItem & { distance: number })[] }>(`/geo/nearby-faults?lat=${lat}&lng=${lng}&radius=${radius}`),
  tileUrl: (source: string, z: number | string, x: number | string, y: number | string) =>
    `${import.meta.env?.VITE_API_BASE ?? "/api/v1"}/map/tile/${source}/${z}/${x}/${y}`,
};
