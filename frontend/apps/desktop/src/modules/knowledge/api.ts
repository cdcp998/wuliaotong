/** knowledge 模块前端 API（知识库；对应方案 §6.4）。 */
import { http } from "@wlt/shared";

export interface ArticleItem {
  id: number;
  title: string;
  version: number;
  published_version: number;
  category: string;
  tags: string[];
  related_cable_types: string[];
  related_fault_types: string[];
  author_type: string;
  status: number; // 0草稿/1已发布/2已归档
  source_task_id: number;
  created_by: number;
  published_at: string | null;
  updated_at: string | null;
  content?: string;
}

export interface GenerateStatus {
  task_id: number;
  status: string;
  topic: string;
  article_id: number | null;
  last_error: string;
  retry_count: number;
  finished_at: string | null;
}

export interface Page<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export const knowledgeApi = {
  list: (params: { status?: string; keyword?: string; category?: string; page?: number; page_size?: number } = {}) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") p.set(k, String(v));
    });
    return http.get<Page<ArticleItem>>(`/knowledge?${p.toString()}`);
  },
  get: (id: number) => http.get<ArticleItem>(`/knowledge/${id}`),
  create: (body: { title: string; content: string; category?: string; tags?: string[]; related_fault_types?: string[] }) =>
    http.post<ArticleItem>("/knowledge", body),
  update: (id: number, body: { title?: string; content?: string; category?: string; tags?: string[]; related_fault_types?: string[] }) =>
    http.put<ArticleItem>(`/knowledge/${id}`, body),
  publish: (id: number) => http.post<ArticleItem>(`/knowledge/${id}/publish`),
  archive: (id: number) => http.post<ArticleItem>(`/knowledge/${id}/archive`),
  generate: (body: { title?: string; topic: string; context?: string }) => http.post<{ task_id: number }>("/knowledge/generate", body),
  generateStatus: (taskId: number) => http.get<GenerateStatus>(`/knowledge/generate/${taskId}`),
  search: (keyword: string, limit = 10) => http.post<{ items: { id: number; title: string; snippet: string; category: string }[] }>("/knowledge/search", { keyword, limit }),
};
