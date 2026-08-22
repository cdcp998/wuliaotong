/** cable 模块前端 API（线缆/故障/测距导航/地图缓存；对应方案 §6.2）。 */
import { http } from "@wlt/shared";

export interface CablePointItem {
  seq: number;
  lat: number;
  lng: number;
  cumulative_distance: number;
  label: string;
}

export interface CableItem {
  id: number;
  code: string;
  name: string;
  type: string; // wire/fiber/network
  total_length: number;
  geometry: { type: string; coordinates: [number, number][] } | null;
  status: number; // 1 在用 / 0 停用 / 2 归档
  description: string;
  points?: CablePointItem[];
}

export interface FaultItem {
  id: number;
  cable_id: number | null;
  lat: number;
  lng: number;
  cumulative_distance: number;
  fault_type: string;
  severity: number; // 1低/2中/3高
  description: string;
  status: number; // 0待处理/1处理中/2待验证/3已修复/4已关闭
  reported_by: number;
  reported_at: string;
  photos_note: string;
  distance?: number;
}

export interface MarkerItem {
  id: number;
  lat: number;
  lng: number;
  cumulative_distance: number;
  marker_type: string;
  label: string;
  remark: string;
}

export interface Page<T> {
  total: number;
  page?: number;
  page_size?: number;
  items: T[];
}

export interface MapSourceInfo {
  key: string;
  name: string;
  type: string;
  coordinate_space: "wgs84" | "gcj02" | "bd09";
  url_template?: string;
  enabled: boolean;
  api_key?: string;
  api_secret?: string;
}

export interface MeasureResult {
  lat: number;
  lng: number;
  cumulative_distance: number;
  total_length: number;
  nearest_marker: { label: string; distance: number } | null;
}

export interface NavigateResult {
  straight_distance: number;
  projection: { lat: number; lng: number; cumulative_distance: number } | null;
  fault_cumulative: number;
  remaining_distance: number;
  path: [number, number][];
  candidates: { cable_id: number; cable_name: string; projection: { lat: number; lng: number; cumulative_distance: number }; fault_cumulative: number; distance_to_user: number; heading_diff: number | null }[];
  recommended: boolean;
}

export const cableApi = {
  // ---- 线缆 ----
  listCables: (params: { keyword?: string; type?: string; status?: string; page?: number; page_size?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") p.set(k, String(v));
    });
    return http.get<Page<CableItem>>(`/cables?${p.toString()}`);
  },
  getCable: (id: number) => http.get<CableItem>(`/cables/${id}`),
  createCable: (body: { code: string; name: string; type: string; status?: number; description?: string; points: { lat: number; lng: number; label?: string }[] }) =>
    http.post<CableItem>("/cables", body),
  updateCable: (id: number, body: { name?: string; type?: string; status?: number; description?: string }) =>
    http.put<CableItem>(`/cables/${id}`, body),
  updatePoints: (id: number, points: { lat: number; lng: number; label?: string }[]) =>
    http.post<CableItem>(`/cables/${id}/points`, { points }),
  updateCableStatus: (id: number, status: number) =>
    http.put<CableItem>(`/cables/${id}/status`, { status }),
  // ---- 标记点 ----
  listMarkers: (cableId: number) => http.get<MarkerItem[]>(`/cables/${cableId}/markers`),
  createMarker: (cableId: number, body: { lat: number; lng: number; marker_type?: string; label?: string; remark?: string }) =>
    http.post<{ id: number; cumulative_distance: number }>(`/cables/${cableId}/markers`, body),
  deleteMarker: (cableId: number, markerId: number) =>
    http.delete<null>(`/cables/${cableId}/markers/${markerId}`),
  // ---- 故障 ----
  listFaults: (params: { status?: string; severity?: string; near?: string; page?: number; page_size?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") p.set(k, String(v));
    });
    return http.get<Page<FaultItem>>(`/faults?${p.toString()}`);
  },
  createFault: (body: { cable_id?: number | null; lat: number; lng: number; fault_type?: string; severity?: number; description?: string }) =>
    http.post<{ id: number }>("/faults", body),
  updateFaultStatus: (id: number, status: number) =>
    http.put<FaultItem>(`/faults/${id}/status`, { status }),
  addFaultPhoto: (id: number, fileId: number, category = "现场") =>
    http.post<{ id: number }>(`/faults/${id}/photos`, { file_id: fileId, category }),
  listFaultPhotos: (id: number) =>
    http.get<{ id: number; file_id: number; category: string; remark: string; url: string }[]>(`/faults/${id}/photos`),
  // ---- 测距/导航 ----
  measure: (body: { cable_id: number; distance: number }) => http.post<MeasureResult>("/geo/measure", body),
  navigate: (body: { lat: number; lng: number; fault_id: number; heading?: number }) =>
    http.post<NavigateResult>("/geo/navigate", body),
  nearbyFaults: (lat: number, lng: number, radius = 500) =>
    http.get<{ items: (FaultItem & { distance: number })[] }>(`/geo/nearby-faults?lat=${lat}&lng=${lng}&radius=${radius}`),
  // ---- 地图源/缓存区域 ----
  mapSources: () => http.get<{ map_sources: Record<string, MapSourceInfo> }>("/map/sources"),
  saveMapSources: (sources: MapSourceInfo[]) => http.put<{ saved: number }>("/map/sources", sources),
  listRegions: () =>
    http.get<
      { id: number; name: string; geometry: unknown; min_zoom: number; max_zoom: number; tile_count: number; cache_size: number; last_download_at: string | null; update_mode: string; status: number }[]
    >("/map/cache/regions"),
  createRegion: (body: { name: string; geometry?: unknown; min_zoom: number; max_zoom: number; update_mode: string }) =>
    http.post<{ id: number }>("/map/cache/regions", body),
  startRegionDownload: (id: number) => http.post<{ tiles_queued?: number }>(`/map/cache/regions/${id}/start`),
  pauseRegionDownload: (id: number) => http.post<null>(`/map/cache/regions/${id}/pause`),
  clearRegion: (id: number) => http.post<{ tiles_removed?: number }>(`/map/cache/regions/${id}/clear`),
  downloadProgress: () =>
    http.get<{ pending: number; done: number; failed: number; regions: { id: number; name: string; status: number; tile_count: number; pending: number; last_download_at: string | null }[] }>("/map/downloads"),
  /** 瓦片代理 URL（经后端缓存；Session Cookie 同源携带）。 */
  tileUrl: (source: string, z: number | string, x: number | string, y: number | string) =>
    `${import.meta.env?.VITE_API_BASE ?? "/api/v1"}/map/tile/${source}/${z}/${x}/${y}`,
};
