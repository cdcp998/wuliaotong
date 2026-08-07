/** 系统初始化安装接口（《后端API设计.md》§1.1）：首次启动引导，未初始化时前端强制进入 /init。 */

import { http } from "./client";

export interface InitStatus {
  initialized: boolean;
  site_name: string;
}

export interface InitInput {
  site_name: string;
  admin_username: string;
  admin_password: string;
  contact_phone?: string;
  /** 数据库连接（提交时自动验证，失败阻止安装） */
  db_host: string;
  db_port: number;
  db_user: string;
  db_password: string;
  db_name: string;
  /** Redis 配置（连接失败降级不阻止，提示重启后生效） */
  redis_host: string;
  redis_port: number;
  redis_password: string;
  redis_db: number;
}

export interface InitResult {
  /** Redis 连接是否成功（false 时缓存降级直查数据库） */
  redis_connected?: boolean;
  redis_warning?: string;
}

export const initApi = {
  status: () => http.get<InitStatus>("/init/status"),
  submit: (body: InitInput) => http.post<InitResult>("/init", body),
};
