/** 手机端任务/知识/设备模块 API（方案 §6.3-§6.5 子集）。 */
import { http } from "@wlt/shared";

export interface TaskItem {
  id: number;
  task_no: string;
  title: string;
  status: string;
  priority: number;
  assignee_name: string;
  verdict: string;
  description: string;
}

export interface Page<T> {
  total: number;
  items: T[];
}

export const TASK_STATUS: Record<string, string> = {
  pending: "待领取", in_progress: "进行中", done: "待审核",
  closed: "已关闭", cancelled: "已取消",
  // 历史兼容态（不再产生新数据）
  assigned: "已派发", verified: "已验证",
};

export const taskApi = {
  list: (params: { status?: string; page_size?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    return http.get<Page<TaskItem>>(`/tasks?${p.toString()}`);
  },
  status: (id: number, body: { action: string; verdict?: string; reason?: string }) =>
    http.post<TaskItem>(`/tasks/${id}/status`, body),
  addRecord: (id: number, body: { content: string; files?: { file_id: number }[] }) =>
    http.post<{ id: number }>(`/tasks/${id}/records`, body),
  recommend: (id: number) => http.post<{ items: { id: number; title: string; snippet: string }[] }>(`/tasks/${id}/knowledge-recommend`),
};

export interface ArticleItem {
  id: number;
  title: string;
  category: string;
  status: number;
  author_type: string;
  content?: string;
}

export const knowledgeApi = {
  list: (pageSize = 50) => http.get<Page<ArticleItem>>(`/knowledge?page_size=${pageSize}`),
  get: (id: number) => http.get<ArticleItem>(`/knowledge/${id}`),
  search: (keyword: string) => http.post<{ items: { id: number; title: string; snippet: string }[] }>("/knowledge/search", { keyword, limit: 20 }),
};

export interface DeviceItem {
  id: number;
  code: string;
  name: string;
  model: string;
  category: string;
  location: string;
  lat: number | null;
  lng: number | null;
  status: number;
  cover_file_id?: number | null;
}

export const DEVICE_STATUS: Record<number, string> = { 1: "在用", 2: "维修中", 3: "闲置", 4: "报废" };

export const deviceApi = {
  list: (params: { page_size?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    return http.get<Page<DeviceItem>>(`/devices?${p.toString()}`);
  },
  create: (body: { code: string; name: string; model?: string; category?: string; location?: string; lat?: number | null; lng?: number | null; status?: number }) =>
    http.post<{ id: number }>("/devices", body),
  addDeviceFile: (id: number, fileId: number) => http.post<{ id: number }>(`/devices/${id}/files`, { file_id: fileId }),
};
