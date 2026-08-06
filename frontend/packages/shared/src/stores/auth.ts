/** 认证全局状态（Zustand）：登录态、权限点、hasPerm 校验。 */

import { create } from "zustand";

import { authApi, type UserInfo } from "../api/auth";

interface AuthState {
  user: UserInfo | null;
  loading: boolean;
  login: (username: string, password: string, captchaId?: string, captchaCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  hasPerm: (code: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,

  login: async (username, password, captchaId = "", captchaCode = "") => {
    set({ loading: true });
    try {
      const resp = await authApi.login(username, password, captchaId, captchaCode);
      set({ user: resp.user });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      set({ user: null });
    }
  },

  fetchMe: async () => {
    const resp = await authApi.me();
    set({ user: resp.user });
  },

  hasPerm: (code) => {
    const user = get().user;
    if (!user) return false;
    if (user.role?.code === "super_admin") return true;
    return user.permissions.includes(code);
  },
}));
