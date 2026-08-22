/** 认证全局状态（Zustand）：登录态、权限点、动态菜单、hasPerm 校验。 */

import { create } from "zustand";

import { authApi, type UserInfo } from "../api/auth";
import { menuApi, type MenuNode } from "../api/menu";

interface AuthState {
  user: UserInfo | null;
  menus: MenuNode[]; // 当前用户可见菜单树（动态导航渲染）
  loading: boolean;
  login: (username: string, password: string, captchaId?: string, captchaCode?: string, remember?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  fetchMenus: () => Promise<void>;
  hasPerm: (code: string) => boolean;
  hasAnyPerm: (codes: string[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  menus: [],
  loading: false,

  login: async (username: string, password: string, captchaId = "", captchaCode = "", remember = false) => {
    set({ loading: true });
    try {
      const resp = await authApi.login(username, password, captchaId, captchaCode, remember);
      set({ user: resp.user });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      set({ user: null, menus: [] });
    }
  },

  fetchMe: async () => {
    const resp = await authApi.me();
    set({ user: resp.user });
  },

  fetchMenus: async () => {
    try {
      const menus = await menuApi.menus();
      set({ menus });
    } catch {
      set({ menus: [] });
    }
  },

  hasPerm: (code) => {
    const user = get().user;
    if (!user) return false;
    if (user.role?.code === "super_admin") return true;
    return user.permissions.includes(code);
  },

  hasAnyPerm: (codes) => {
    const user = get().user;
    if (!user) return false;
    if (user.role?.code === "super_admin") return true;
    return codes.some((code) => user.permissions.includes(code));
  },
}));
