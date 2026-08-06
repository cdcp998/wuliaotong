/** 统一 API 客户端（《后端API设计.md》§0）：Session Cookie 认证、统一响应解包、401 跳登录。 */

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export class BizError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "/api/v1";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include", // Session Cookie
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new BizError(4004, "未登录或会话已过期");
  }
  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 0) {
    throw new BizError(json.code, json.message);
  }
  return json.data;
}

export const http = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export interface PageData<T> {
  list: T[];
  total: number;
  page: number;
  page_size: number;
}
