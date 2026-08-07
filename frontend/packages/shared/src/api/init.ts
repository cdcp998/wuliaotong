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
}

export const initApi = {
  status: () => http.get<InitStatus>("/init/status"),
  submit: (body: InitInput) => http.post<null>("/init", body),
};
