/** 系统设置接口（OCR 引擎/大模型 API 后台管理）。 */
import { http, type PageData } from "./client";

export interface Settings {
  "site.name": string;
  "session.expire_hours": string;
  "ocr.engine": string;
  "bill.rule": string;
  "llm.doubao.api_key": string;
  "llm.doubao.base_url": string;
  "llm.doubao.model": string;
  "llm.deepseek.api_key": string;
  "llm.deepseek.base_url": string;
  "llm.deepseek.model": string;
  "auth.register_mode": string;
  "auth.forgot_method": string;
  "site.contact_phone": string;
  "smtp.host": string;
  "smtp.port": string;
  "smtp.user": string;
  "smtp.password": string;
  "smtp.from": string;
}

export const systemApi = {
  getSettings: () => http.get<Settings>("/settings"),
  updateSettings: (body: Partial<Settings>) => http.put<null>("/settings", body),
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
