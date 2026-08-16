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
/** 应用路由基路径：桌面端为 "/"，手机端生产构建为 "/m/"（与 vite base / 路由 basename 一致）。 */
const APP_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.BASE_URL ?? "/";

/** 统一 API 基地址（所有 fetch/文件 URL 必须经此拼接，禁止散落硬编码 "/api/v1"）。 */
export function apiBase(): string {
  return API_BASE;
}

/** 当前端的登录页地址（手机端部署在 /m/ 下时 401 跳转不再误跳桌面端登录页）。 */
export function loginUrl(): string {
  return `${APP_BASE}login`;
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  // 超时兜底：OCR 等同步识别接口若服务端挂起，客户端不能无限等待（拍照识别卡死）
  const ctrl = timeoutMs ? new AbortController() : undefined;
  const timer = timeoutMs ? setTimeout(() => ctrl!.abort(), timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include", // Session Cookie
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl?.signal,
    });
  } catch (e) {
    if (ctrl?.signal.aborted) throw new BizError(408, "请求超时，请重试");
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401) {
    // 已在登录页时不再重复跳转（location.href 赋相同值也会整页刷新，导致登录页无限刷新循环）
    const target = loginUrl();
    if (window.location.pathname !== target) {
      window.location.href = target;
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
  get: <T>(path: string, timeoutMs?: number) => request<T>("GET", path, undefined, timeoutMs),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) => request<T>("POST", path, body, timeoutMs),
  put: <T>(path: string, body?: unknown, timeoutMs?: number) => request<T>("PUT", path, body, timeoutMs),
  delete: <T>(path: string, body?: unknown, timeoutMs?: number) => request<T>("DELETE", path, body, timeoutMs),
};

export interface PageData<T> {
  list: T[];
  total: number;
  page: number;
  page_size: number;
}
