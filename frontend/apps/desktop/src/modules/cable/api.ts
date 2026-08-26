/** cable 模块前端 API（线缆/故障/测距导航；地图相关见 map 模块）。 */
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

export interface FaultLinkedTask {
  id: number;
  task_no: string;
  title: string;
  status: string;
  assignee_id: number;
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
  /** v1.1 六态：0待派发/1已派发/2进行中/3完成待验/4已验证/5已关闭（与维修任务态联动） */
  status: number;
  status_label?: string;
  reported_by: number;
  reported_at: string;
  photos_note: string;
  distance?: number;
  /** 反向关联的维修任务（task 模块启用时后端返回；联动视图跳转用） */
  linked_tasks?: FaultLinkedTask[];
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

/** 故障状态六态（v1.1 与维修任务态一一对应，统一联动视图）：
 *  待派发 › 已派发 › 进行中 › 完成待验 › 已验证 › 已关闭 */
export const FAULT_STATUS: Record<number, { label: string; fg: string; bg: string; next?: number }> = {
  0: { label: "待派发", fg: "#DC2626", bg: "#FDEBEC", next: 1 },
  1: { label: "已派发", fg: "#3B5BDB", bg: "#EAEFFF", next: 2 },
  2: { label: "进行中", fg: "#0E7490", bg: "#E0F2FE", next: 3 },
  3: { label: "完成待验", fg: "#B45309", bg: "#FEF4E2", next: 4 },
  4: { label: "已验证", fg: "#15803D", bg: "#E8F9EF", next: 5 },
  5: { label: "已关闭", fg: "#8A93A8", bg: "#EFF3FC" },
};

/** 状态流转步骤（与 DeviceTasks 状态流转条同款文案）。 */
export const FAULT_FLOW_STEPS = ["待派发", "已派发", "进行中", "完成待验", "已验证", "已关闭"];

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
  listFaults: (params: { status?: string; severity?: string; near?: string; exclude_closed?: boolean; page?: number; page_size?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") p.set(k, String(v));
    });
    return http.get<Page<FaultItem>>(`/faults?${p.toString()}`);
  },
  deleteFault: (id: number) => http.delete<null>(`/faults/${id}`),
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
};
