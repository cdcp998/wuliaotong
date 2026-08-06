/** 认证接口（《后端API设计.md》§1）。 */

import { http } from "./client";

export interface RoleInfo {
  id: number;
  code: string;
  name: string;
}

export interface UserInfo {
  id: number;
  username: string;
  real_name: string;
  role: RoleInfo | null;
  permissions: string[];
}

export interface LoginResp {
  user: UserInfo;
}

export const authApi = {
  login: (username: string, password: string) =>
    http.post<LoginResp>("/auth/login", { username, password }),
  logout: () => http.post<null>("/auth/logout"),
  me: () => http.get<{ user: UserInfo }>("/auth/me"),
};
