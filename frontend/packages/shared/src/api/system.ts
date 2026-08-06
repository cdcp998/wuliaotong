/** 系统设置接口（OCR 引擎/大模型 API 后台管理）。 */
import { http } from "./client";

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
}

export const systemApi = {
  getSettings: () => http.get<Settings>("/settings"),
  updateSettings: (body: Partial<Settings>) => http.put<null>("/settings", body),
};
