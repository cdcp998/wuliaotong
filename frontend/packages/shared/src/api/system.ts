/** 系统设置接口（OCR 引擎/大模型 API 后台管理）。 */
import { apiBase, http, type PageData } from "./client";

export interface Settings {
  "site.name": string;
  "session.expire_hours": string;
  "ocr.engine": string;
  "ocr.model_version": string;
  "llm.doubao.enabled": string;
  // 模型承担任务开关（1 启用 / 0 关闭该任务跳过此模型）
  "llm.doubao.scene.match_vision": string;
  "llm.doubao.scene.vision_product": string;
  "llm.doubao.scene.classify_items": string;
  "llm.doubao.scene.ocr_correct": string;
  "llm.doubao.scene.vision_text": string;
  "llm.doubao.scene.structured": string;
  "llm.siliconflow.scene.vision_delivery": string;
  "llm.siliconflow.scene.vision_product": string;
  "llm.siliconflow.scene.vision_text": string;
  "llm.siliconflow.scene.match_vision": string;
  "llm.deepseek.scene.ocr_correct": string;
  "llm.deepseek.scene.classify_items": string;
  "llm.deepseek.scene.structured": string;
  "llm.deepseek.enabled": string;
  "llm.doubao.api_key": string;
  "llm.doubao.base_url": string;
  "llm.doubao.model": string;
  "llm.deepseek.api_key": string;
  "llm.deepseek.base_url": string;
  "llm.deepseek.model": string;
  "llm.siliconflow.enabled": string;
  "llm.siliconflow.api_key": string;
  "llm.siliconflow.base_url": string;
  "llm.siliconflow.model": string;
  "auth.register_mode": string;
  "auth.forgot_method": string;
  "site.contact_phone": string;
  "smtp.host": string;
  "smtp.port": string;
  "smtp.user": string;
  "smtp.password": string;
  "smtp.from": string;
  "watermark.template": string;
  "watermark.position": string;
  "watermark.bg_opaque": string;
  "log.level": string;
  "quota.warning.enabled": string;
  "quota.warning.recipients": string;
  "quota.refresh.interval_minutes": string;
  "quota.warning.threshold.siliconflow": string;
  "quota.warning.threshold.deepseek": string;
  "quota.warning.threshold.doubao": string;
}

/** PP-OCR 自动安装状态（设置页轮询）；done 时 mode 表示 paddle 是否启用 CUDA（cpu/gpu）。 */
export interface OcrInstallState {
  status: "idle" | "installing" | "done" | "failed";
  mode?: "cpu" | "gpu";
  log: string;
}

/** 单个服务商配额项（余额/资源包等）。 */
export interface QuotaItem {
  name: string;
  value: number | null;
  unit: string;
  remaining: number | null;
  status: string | null;
}

/** 一次配额获取结果（成功或失败都返回，失败带 error）。 */
export interface QuotaPayload {
  provider: string;
  ok: boolean;
  fetched_at: string;
  items?: QuotaItem[];
  error?: string;
}

/** 模型参与的工作任务（含启用状态）。 */
export interface ModelSceneInfo {
  name: string;
  label: string;
  enabled: boolean;
  scenes: { scene: string; role: string; label: string; desc: string }[];
}

export const systemApi = {
  getSettings: () => http.get<Settings>("/settings"),
  updateSettings: (body: Partial<Settings>) => http.put<null>("/settings", body),
  /** 用已保存的 SiliconFlow Key 拉取模型列表（保存设置后调用）。 */
  listSiliconflowModels: () => http.post<{ models: { id: string; owned_by: string }[] }>("/llm/siliconflow/models"),
  /** 用已保存的 DeepSeek Key 拉取模型列表（保存设置后调用）。 */
  listDeepseekModels: () => http.post<{ models: { id: string; owned_by: string }[] }>("/llm/deepseek/models"),
  /** 用已保存的豆包 Key 拉取模型列表（保存设置后调用）。 */
  listDoubaoModels: () => http.post<{ models: { id: string; owned_by: string }[] }>("/llm/doubao/models"),
  installPaddle: () => http.post<OcrInstallState>("/ocr/install-paddle"),
  /** 大模型调用日志（P9）：按场景/状态筛选分页查询。 */
  llmLogs: (scene = "", status = "", page = 1, pageSize = 20) => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (scene) p.set("scene", scene);
    if (status) p.set("status", status);
    return http.get<PageData<{ id: number; scene: string; model: string; prompt: string; output: string; status: string; error: string; duration_ms: number; created_at: string }>>(`/llm-logs?${p.toString()}`);
  },
  /** 批量删除大模型调用日志（勾选多条后删除）。 */
  deleteLlmLogs: (ids: number[]) => http.delete<{ deleted: number }>("/llm-logs", { ids }),
  /** 读取最近一次获取的各服务商配额快照（含失败信息）。 */
  getQuota: () => http.get<{ providers: Record<string, QuotaPayload> }>("/llm/quota"),
  /** 立即从服务商获取配额/余额（失败返回 ok=false + error，不抛异常）。 */
  fetchQuota: (provider: string) => http.post<QuotaPayload>(`/llm/quota/${provider}`),
  /** 模型参与的工作任务映射（含启用状态）。 */
  getModelScenes: () => http.get<{ models: ModelSceneInfo[] }>("/llm/model-scenes"),
  installStatus: () => http.get<OcrInstallState>("/ocr/install-status"),
  /** 水印预览（示例底图，未保存也可预览）：返回 blob URL。 */
  previewWatermark: async (body: { template?: string; position?: string; bg_opaque?: boolean; location?: string; time?: string; gps?: string }) => {
    const resp = await fetch(`${apiBase()}/watermark/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error("预览生成失败");
    return URL.createObjectURL(await resp.blob());
  },
};

/** 站内通知（《后端API设计.md》§9）：预警/待办/审批。 */
export interface NotificationItem {
  id: number;
  title: string;
  content: string;
  biz_type: string; // 预警 / 待办 / 审批
  is_read: number;
  created_at: string;
}

export const notificationApi = {
  list: (isRead?: number, page = 1) =>
    http.get<PageData<NotificationItem>>(
      `/notifications${isRead !== undefined ? `?is_read=${isRead}` : ""}${isRead !== undefined ? "&" : "?"}page=${page}&page_size=20`
    ),
  unreadCount: () => http.get<{ unread_count: number }>("/notifications/unread-count"),
  markRead: (id: number) => http.put<null>(`/notifications/${id}/read`),
  markReadAll: () => http.put<null>("/notifications/read-all"),
};

/** 存储位置（多存储地址管理，《后端API设计.md》§7）。 */
export interface StorageItem {
  id: number;
  name: string;
  type: string; // 当前仅 local
  path: string;
  policy: "fill" | "round" | "manual"; // 最空闲 / 轮询 / 手动指定
  is_default: number;
  status: number; // 1 启用 / 0 停用
  remark: string;
  file_count: number;
}

/** 存储位置提交参数（新增/编辑共用）。 */
export interface StoragePayload {
  name: string;
  type?: string;
  path: string;
  policy: "fill" | "round" | "manual";
  is_default?: number;
  status?: number;
  remark?: string;
}

/** 单存储健康检测结果（路径存在/可写/空间）。 */
export interface StorageHealth {
  id: number;
  name: string;
  path: string;
  exists: boolean;
  writable: boolean;
  total_gb: number;
  free_gb: number;
}

export const storageApi = {
  list: () => http.get<StorageItem[]>("/storages"),
  create: (body: StoragePayload) => http.post<StorageItem>("/storages", body),
  update: (id: number, body: StoragePayload) => http.put<null>(`/storages/${id}`, body),
  remove: (id: number) => http.delete<null>(`/storages/${id}`),
  health: () => http.get<StorageHealth[]>("/storages/health"),
};
