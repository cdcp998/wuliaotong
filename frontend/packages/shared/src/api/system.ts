/** 系统设置接口（OCR 引擎/大模型 API 后台管理）。 */
import { http, type PageData } from "./client";

export interface Settings {
  "site.name": string;
  "session.expire_hours": string;
  "ocr.engine": string;
  "ocr.model_version": string;
  "llm.doubao.enabled": string;
  "llm.deepseek.enabled": string;
  "bill.rule": string;
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
}

/** PP-OCR 自动安装状态（设置页轮询）；done 时 mode 表示 paddle 是否启用 CUDA（cpu/gpu）。 */
export interface OcrInstallState {
  status: "idle" | "installing" | "done" | "failed";
  mode?: "cpu" | "gpu";
  log: string;
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
  installStatus: () => http.get<OcrInstallState>("/ocr/install-status"),
  /** 水印预览（示例底图，未保存也可预览）：返回 blob URL。 */
  previewWatermark: async (body: { template?: string; position?: string; bg_opaque?: boolean; location?: string; time?: string; gps?: string }) => {
    const resp = await fetch("/api/v1/watermark/preview", {
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
