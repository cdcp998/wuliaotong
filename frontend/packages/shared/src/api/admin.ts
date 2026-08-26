/** 系统管理接口（P7）：用户/角色/权限/操作日志/备份。 */
import { apiBase, http, type PageData } from "./client";

export interface SysUser {
  id: number;
  username: string;
  real_name: string;
  phone: string;
  email: string;
  role_id: number;
  role_name: string;
  department_id: number;
  department_name: string;
  status: number;
  last_login_at: string | null;
  created_at: string;
}

export interface SysRole {
  id: number;
  code: string;
  name: string;
  description: string;
  is_builtin: number;
  department_id: number;
  department_name: string;
  permission_ids: number[];
  permission_codes: string[];
}

export interface SysPermission {
  id: number;
  parent_id: number;
  name: string;
  code: string;
  type: number;
}

export interface OperationLog {
  id: number;
  username: string;
  module: string;
  action: string;
  method: string;
  url: string;
  params: string;
  /** 请求体 JSON（脱敏后）——「具体改了什么」。 */
  body: string;
  /** 字段级变更 old/new JSON——「修改前后对比」。 */
  diff: string;
  ip: string;
  duration_ms: number;
  status_code: number;
  created_at: string;
}

export interface BackupRecord {
  id: number;
  file_path: string;
  file_size: number;
  backup_type: string;
  status: number;
  created_at: string;
}

export interface RegisterApply {
  id: number;
  username: string;
  real_name: string;
  phone: string;
  email: string;
  status: number;
  created_at: string;
}

export interface Department {
  id: number;
  code: string;
  name: string;
  remark: string;
  status: number;
  shelf_ids: number[];
}

export const adminApi = {
  users: (params: { keyword?: string; status?: number; role_id?: number; page?: number; page_size?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.keyword) q.set("keyword", params.keyword);
    if (params.status !== undefined) q.set("status", String(params.status));
    if (params.role_id) q.set("role_id", String(params.role_id));
    q.set("page", String(params.page ?? 1));
    q.set("page_size", String(params.page_size ?? 20));
    return http.get<PageData<SysUser>>(`/users?${q}`);
  },
  createUser: (body: { username: string; password: string; real_name?: string; phone?: string; email?: string; role_id: number; department_id?: number }) =>
    http.post<{ id: number; username: string }>("/users", body),
  updateUser: (id: number, body: { real_name?: string; phone?: string; email?: string; role_id?: number; department_id?: number; status?: number; password?: string }) =>
    http.put<null>(`/users/${id}`, body),
  deleteUser: (id: number) => http.delete<null>(`/users/${id}`),

  roles: () => http.get<SysRole[]>("/roles"),
  createRole: (body: { code: string; name: string; description?: string; department_id?: number }) => http.post<{ id: number; code: string }>("/roles", body),
  updateRole: (id: number, body: { name?: string; description?: string }) => http.put<null>(`/roles/${id}`, body),
  deleteRole: (id: number) => http.delete<null>(`/roles/${id}`),
  permissions: () => http.get<SysPermission[]>("/permissions"),
  updateRolePermissions: (id: number, permissionIds: number[]) => http.put<null>(`/roles/${id}/permissions`, { permission_ids: permissionIds }),

  logs: (params: { username?: string; module?: string; method?: string; start?: string; end?: string; page?: number; page_size?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    q.set("page", String(params.page ?? 1));
    q.set("page_size", String(params.page_size ?? 20));
    return http.get<PageData<OperationLog>>(`/logs?${q}`);
  },
  /** 操作日志导出 Excel（统一导出服务，模块标识 operation_logs；fmt=「导出格式设置」JSON 可选）。 */
  logsExportUrl: (params: { username?: string; module?: string; method?: string; start?: string; end?: string; fmt?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    return `${apiBase()}/logs/export?${q}`;
  },
  /** 操作日志导出预览：preview=1 返回前 10 条 JSON（「导出格式设置」预览用）。 */
  logsExportPreview: (params: { username?: string; module?: string; method?: string; start?: string; end?: string; fmt?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    q.set("preview", "1");
    return http.get<{ headers: string[]; rows: string[][] }>(`/logs/export?${q}`);
  },

  backups: (page = 1, pageSize = 20) => http.get<PageData<BackupRecord>>(`/backups?page=${page}&page_size=${pageSize}`),
  createBackup: () => http.post<{ id: number; file_path: string; file_size: number }>("/backups"),
  deleteBackup: (id: number) => http.delete<null>(`/backups/${id}`),
  backupDownloadUrl: (id: number) => `${apiBase()}/backups/${id}/download`,

  registerApplies: (status?: number, page = 1, pageSize = 20) =>
    http.get<PageData<RegisterApply>>(
      `/register-applies${status !== undefined ? `?status=${status}` : ""}${status !== undefined ? "&" : "?"}page=${page}&page_size=${pageSize}`
    ),
  approveRegisterApply: (id: number) => http.post<{ message: string }>(`/register-applies/${id}/approve`),
  rejectRegisterApply: (id: number) => http.post<{ message: string }>(`/register-applies/${id}/reject`),

  departments: () => http.get<Department[]>("/departments"),
  createDepartment: (body: { name: string; remark?: string }) =>
    http.post<{ id: number; code: string }>("/departments", body),
  updateDepartment: (id: number, body: { name?: string; remark?: string; status?: number }) =>
    http.put<null>(`/departments/${id}`, body),
  deleteDepartment: (id: number) => http.delete<null>(`/departments/${id}`),
  updateDepartmentShelves: (id: number, shelfIds: number[]) =>
    http.put<null>(`/departments/${id}/shelves`, { shelf_ids: shelfIds }),
};
