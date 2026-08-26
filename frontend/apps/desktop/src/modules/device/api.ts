/** device 模块前端 API（设备台账/维修任务；对应方案 §6.5）。 */
import { http } from "@wlt/shared";

export interface DeviceItem {
  id: number;
  code: string;
  name: string;
  model: string;
  category: string;
  department_id: number;
  location: string;
  lat: number | null;
  lng: number | null;
  status: number;
  purchase_date: string | null;
  warranty_end: string | null;
  remark: string;
  cover_file_id?: number | null;
  updated_at: string | null;
}

export interface DeviceTaskItem {
  id: number;
  task_no: string;
  device_id: number;
  device_name: string;
  device_code: string;
  title: string;
  description: string;
  assignee_id: number;
  assignee_name: string;
  status: string;
  priority: number;
  scheduled_time: string | null;
  completed_at: string | null;
  verdict: string;
  previous_status: number;
  cancel_reason: string;
  created_by: number;
  creator_name: string;
  created_at: string;
  /** v2 无锁协作：参与留痕（谁领取/领料/完成）。 */
  participants?: { user_id: number; name: string; actions: string[] }[];
  events?: { user_id: number; name: string; action: string; action_label: string; created_at: string | null }[];
}

export interface Page<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export const DEVICE_STATUS: Record<number, { label: string; color: string }> = {
  1: { label: "在用", color: "success" },
  2: { label: "维修中", color: "warning" },
  3: { label: "闲置", color: "default" },
  4: { label: "报废", color: "error" },
};

export const DTASK_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "待派发", color: "default" },
  assigned: { label: "已派发", color: "blue" },
  in_progress: { label: "进行中", color: "processing" },
  done: { label: "已完成", color: "cyan" },
  verified: { label: "已验证", color: "success" },
  closed: { label: "已关闭", color: "default" },
  cancelled: { label: "已取消", color: "error" },
};

/** 派发方式（历史遗留展示用）：v1.2 起统一手动派发，公开领取模式已移除。 */

export const deviceApi = {
  list: (params: { keyword?: string; status?: string; page?: number; page_size?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") p.set(k, String(v));
    });
    return http.get<Page<DeviceItem>>(`/devices?${p.toString()}`);
  },
  create: (body: Partial<DeviceItem>) => http.post<DeviceItem>("/devices", body),
  update: (id: number, body: Partial<DeviceItem>) => http.put<DeviceItem>(`/devices/${id}`, body),
  status: (id: number, status: number) => http.put<DeviceItem>(`/devices/${id}/status`, { status }),
  listFiles: (id: number) => http.get<{ id: number; file_id: number }[]>(`/devices/${id}/files`),
  addFile: (id: number, fileId: number) => http.post<{ id: number }>(`/devices/${id}/files`, { file_id: fileId }),
  deleteFile: (id: number, linkId: number) => http.delete<null>(`/devices/${id}/files/${linkId}`),
  listTasks: (params: { status?: string; page?: number; page_size?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") p.set(k, String(v));
    });
    return http.get<Page<DeviceTaskItem>>(`/device-tasks?${p.toString()}`);
  },
  createTask: (body: { device_id: number; title: string; description?: string; priority?: number }) =>
    http.post<DeviceTaskItem>("/device-tasks", body),
  assignTask: (id: number, assigneeId: number) => http.post<DeviceTaskItem>(`/device-tasks/${id}/assign`, { assignee_id: assigneeId }),
  taskStatus: (id: number, body: { action: string; assignee_id?: number; verdict?: string; reason?: string }) =>
    http.post<DeviceTaskItem>(`/device-tasks/${id}/status`, body),
  records: (id: number) =>
    http.get<{ id: number; content: string; created_at: string; files: { id: number; file_id: number }[] }[]>(`/device-tasks/${id}/records`),
  addRecord: (id: number, body: { content: string; files: { file_id: number }[] }) =>
    http.post<{ id: number }>(`/device-tasks/${id}/records`, body),
};
