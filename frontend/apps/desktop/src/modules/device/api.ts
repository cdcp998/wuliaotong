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
  /** 派发方式：manual 手动派发 / open 公开抢单 / hybrid 公开+可派发。 */
  dispatch_mode: string;
  priority: number;
  scheduled_time: string | null;
  completed_at: string | null;
  verdict: string;
  previous_status: number;
  cancel_reason: string;
  created_by: number;
  creator_name: string;
  created_at: string;
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

/** 派发方式（设计页 51 扩展：三种派发模式）。 */
export const DISPATCH_MODES: Record<string, { label: string; desc: string; bg: string; fg: string }> = {
  manual: { label: "手动派发", desc: "创建后由调度员指定维修人员", bg: "#EFF3FC", fg: "#5B6478" },
  open: { label: "公开抢单", desc: "发布到任务池，维修人员自行领取", bg: "#EAEFFF", fg: "#3B5BDB" },
  hybrid: { label: "公开+可派发", desc: "进入抢单池，调度员也可直接指派", bg: "#E0F2FE", fg: "#0E7490" },
};

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
  createTask: (body: { device_id: number; title: string; description?: string; priority?: number; dispatch_mode?: string }) =>
    http.post<DeviceTaskItem>("/device-tasks", body),
  claimTask: (id: number) => http.post<DeviceTaskItem>(`/device-tasks/${id}/claim`),
  assignTask: (id: number, assigneeId: number) => http.post<DeviceTaskItem>(`/device-tasks/${id}/assign`, { assignee_id: assigneeId }),
  taskStatus: (id: number, body: { action: string; assignee_id?: number; verdict?: string; reason?: string }) =>
    http.post<DeviceTaskItem>(`/device-tasks/${id}/status`, body),
  records: (id: number) =>
    http.get<{ id: number; content: string; created_at: string; files: { id: number; file_id: number }[] }[]>(`/device-tasks/${id}/records`),
  addRecord: (id: number, body: { content: string; files: { file_id: number }[] }) =>
    http.post<{ id: number }>(`/device-tasks/${id}/records`, body),
};
