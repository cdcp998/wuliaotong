/** map 模块前端 API（图源配置/瓦片代理/缓存区域批量下载）。 */
import { http } from "@wlt/shared";

import type { Page } from "../cable/api";

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

export interface RegionItem {
  id: number;
  name: string;
  geometry: unknown;
  min_zoom: number;
  max_zoom: number;
  tile_count: number;
  cache_size: number;
  last_download_at: string | null;
  update_mode: string;
  status: number;
}

export interface RegionProgress {
  id: number;
  name: string;
  status: number;
  tile_count: number;
  pending: number;
  done: number;
  failed: number;
  total: number;
  last_download_at: string | null;
}

export const mapApi = {
  // ---- 图源 ----
  mapSources: () => http.get<{ map_sources: Record<string, MapSourceInfo>; cache?: Record<string, unknown> }>("/map/sources"),
  saveMapSources: (sources: MapSourceInfo[]) => http.put<{ saved: number }>("/map/sources", sources),
  deleteMapSource: (key: string) => http.delete<{ removed: string; remaining: number }>(`/map/sources/${key}`),
  /** 瓦片代理 URL（经后端缓存；Session Cookie 同源携带）。 */
  tileUrl: (source: string, z: number | string, x: number | string, y: number | string) =>
    `${import.meta.env?.VITE_API_BASE ?? "/api/v1"}/map/tile/${source}/${z}/${x}/${y}`,
  /** 图源更新时间（该源最近一次成功抓取瓦片的时间）。 */
  tileUpdated: (source: string) =>
    http.get<{ source: string; updated_at: string | null }>(`/map/tile-updated/${source}`),
  // ---- 缓存区域 ----
  listRegions: () => http.get<RegionItem[]>("/map/cache/regions"),
  createRegion: (body: { name: string; geometry?: unknown; min_zoom: number; max_zoom: number; update_mode: string }) =>
    http.post<{ id: number }>("/map/cache/regions", body),
  startRegionDownload: (id: number) => http.post<{ tiles_queued?: number }>(`/map/cache/regions/${id}/start`),
  pauseRegionDownload: (id: number) => http.post<null>(`/map/cache/regions/${id}/pause`),
  clearRegion: (id: number) => http.post<{ tiles_removed?: number }>(`/map/cache/regions/${id}/clear`),
  downloadProgress: () =>
    http.get<{ pending: number; done: number; failed: number; regions: RegionProgress[] }>("/map/downloads"),
};

// 供其他模块复用类型
export type { Page };
