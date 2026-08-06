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
    // 已在登录页时不再重复跳转（location.href 赋相同值也会整页刷新，导致登录页无限刷新循环）
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new BizError(4004, "未登录或会话已过期");
  }
  // 用 text() 代替 json()：空响应体（204 / Content-Length 0 / 代理空响应）不会抛 SyntaxError
  const text = await res.text();
  if (!text) {
    // 空体：2xx 视为成功（无业务数据）；非 2xx 视为失败并带 HTTP 状态
    if (!res.ok) throw new BizError(res.status, `请求失败（HTTP ${res.status}）`);
    return undefined as T;
  }
  let json: ApiResponse<T>;
  try {
    json = JSON.parse(text) as ApiResponse<T>;
  } catch {
    // 非 JSON 响应（网关错误页等）→ 抛可读业务错误，避免原生 SyntaxError 泄漏
    throw new BizError(res.status, `响应解析失败（HTTP ${res.status}）`);
  }
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
