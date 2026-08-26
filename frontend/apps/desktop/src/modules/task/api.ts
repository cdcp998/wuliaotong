/** task 模块前端 API（维修任务；对应方案 §6.3）。 */
import { http } from "@wlt/shared";

export interface TaskItem {
  id: number;
  task_no: string;
  cable_id: number | null;
  fault_id: number | null;
  title: string;
  description: string;
  assignee_id: number;
  assignee_name: string;
  status: string;
  priority: number;
  scheduled_time: string | null;
  completed_at: string | null;
  verdict: string;
  cancel_reason: string;
  created_by: number;
  creator_name: string;
  created_at: string;
  /* —— 联动视图关联信息（v1.2，后端 _link_info 注入）—— */
  fault_type?: string;
  fault_status?: number | null;
  fault_status_label?: string;
  severity?: number | null;
  cable_name?: string;
}

export interface Page<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

/** 统一任务池条目（/tasks/pool）：线缆维修任务 + 设备维修任务合并视图。 */
export interface PoolItem {
  source: "cable" | "device";
  /** 前端行 key / 跨页定位符：cable → `c{id}`，device → `d{id}` */
  key: string;
  id: number;
  task_no: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  assignee_id: number;
  assignee_name: string;
  scheduled_time: string | null;
  completed_at: string | null;
  verdict: string;
  cancel_reason: string;
  creator_name: string;
  created_at: string;
  dispatch_mode: string;
  /* 线缆故障关联信息 */
  fault_id: number | null;
  fault_type: string;
  fault_status: number | null;
  severity: number | null;
  cable_id: number | null;
  cable_name: string;
  /* 设备关联信息 */
  device_id: number | null;
  device_name: string;
  device_code: string;
  device_status: number | null;
  previous_status: number | null;
}

export interface TaskRecordItem {
  id: number;
  task_id: number;
  content: string;
  materials_used: unknown[];
  knowledge_snapshot: unknown;
  created_at: string;
  files: { id: number; file_id: number; category: string; remark: string }[];
}

export const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "待派发", color: "default" },
  assigned: { label: "已派发", color: "blue" },
  in_progress: { label: "进行中", color: "processing" },
  done: { label: "已完成", color: "cyan" },
  verified: { label: "已验证", color: "success" },
  closed: { label: "已关闭", color: "default" },
  cancelled: { label: "已取消", color: "error" },
};

export const taskApi = {
  list: (params: { status?: string; keyword?: string; page?: number; page_size?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") p.set(k, String(v));
    });
    return http.get<Page<TaskItem>>(`/tasks?${p.toString()}`);
  },
  /** 统一任务池：线缆 + 设备维修任务合并（device 模块启用时后端自动合并）。 */
  pool: (params: { status?: string; keyword?: string; source?: "" | "cable" | "device"; page?: number; page_size?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") p.set(k, String(v));
    });
    return http.get<Page<PoolItem>>(`/tasks/pool?${p.toString()}`);
  },
  create: (body: { cable_id?: number | null; fault_id?: number | null; title: string; description?: string; priority?: number }) =>
    http.post<TaskItem>("/tasks", body),
  update: (id: number, body: { title?: string; description?: string; priority?: number }) => http.put<TaskItem>(`/tasks/${id}`, body),
  assign: (id: number, assigneeId: number) => http.post<TaskItem>(`/tasks/${id}/assign`, { assignee_id: assigneeId }),
  status: (id: number, body: { action: string; assignee_id?: number; verdict?: string; reason?: string }) =>
    http.post<TaskItem>(`/tasks/${id}/status`, body),
  records: (id: number) => http.get<TaskRecordItem[]>(`/tasks/${id}/records`),
  addRecord: (id: number, body: { content: string; files: { file_id: number; category?: string }[]; materials_used?: unknown[] }) =>
    http.post<{ id: number }>(`/tasks/${id}/records`, body),
  requisitions: (id: number) => http.get<{ id: number; bill_no: string; status: number; use_location: string }[]>(`/tasks/${id}/requisitions`),
  recommend: (id: number) => http.post<{ items: { id: number; title: string; snippet: string }[]; message?: string }>(`/tasks/${id}/knowledge-recommend`),
};
