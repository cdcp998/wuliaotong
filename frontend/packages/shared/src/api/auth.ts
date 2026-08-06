/** 认证接口（《后端API设计.md》§1）：登录/登出/我/修改密码/找回/注册/验证码。 */

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

export interface CaptchaData {
  captcha_id: string;
  image: string;
}

export interface RegisterStatus {
  mode: "open" | "closed" | "review";
  contact_phone: string;
}

export interface ForgotResult {
  method: string;
  contact_phone?: string;
  message: string;
}

export const authApi = {
  login: (username: string, password: string, captchaId = "", captchaCode = "") =>
    http.post<LoginResp>("/auth/login", { username, password, captcha_id: captchaId, captcha_code: captchaCode }),
  logout: () => http.post<null>("/auth/logout"),
  me: () => http.get<{ user: UserInfo }>("/auth/me"),
  captcha: () => http.get<CaptchaData>("/auth/captcha"),
  changePassword: (oldPassword: string, newPassword: string) =>
    http.put<null>("/auth/password", { old_password: oldPassword, new_password: newPassword }),
  forgot: (username: string, email?: string) =>
    http.post<ForgotResult>("/auth/forgot", { username, email: email ?? "" }),
  forgotReset: (username: string, code: string, newPassword: string) =>
    http.post<{ message: string }>("/auth/forgot/reset", { username, code, new_password: newPassword }),
  register: (body: { username: string; password: string; real_name?: string; phone?: string; email?: string }) =>
    http.post<{ status: string; message: string; user_id?: number }>("/auth/register", body),
  registerStatus: () => http.get<RegisterStatus>("/auth/register/status"),
};
