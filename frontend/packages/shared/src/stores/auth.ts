/** 认证全局状态（Zustand）：登录态、权限点、动态菜单、模块状态、hasPerm 校验。 */

import { create } from "zustand";

import { authApi, type UserInfo } from "../api/auth";
import { menuApi, type MenuNode } from "../api/menu";
import { moduleApi, type ModuleInfo } from "../api/modules";

interface AuthState {
  user: UserInfo | null;
  menus: MenuNode[]; // 当前用户可见菜单树（动态导航渲染）
  modules: ModuleInfo[]; // 模块插件状态（系统管理「安装模块」页 + RequireModule 守卫）
  /** 模块状态加载进度：idle 未开始 / loading 拉取中 / ok 已就绪 / error 拉取失败（可重试） */
  modulesStatus: "idle" | "loading" | "ok" | "error";
  loading: boolean;
  login: (username: string, password: string, captchaId?: string, captchaCode?: string, remember?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  fetchMenus: () => Promise<void>;
  fetchModules: () => Promise<void>;
  hasPerm: (code: string) => boolean;
  hasAnyPerm: (codes: string[]) => boolean;
  moduleEnabled: (code: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  menus: [],
  modules: [],
  modulesStatus: "idle",
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
      set({ user: null, menus: [], modules: [], modulesStatus: "idle" });
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

  fetchModules: async () => {
    set({ modulesStatus: "loading" });
    try {
      const modules = await moduleApi.list();
      set({ modules, modulesStatus: "ok" });
    } catch {
      // 拉取失败保留已有数据；状态标记 error 供守卫显示「重试」（不误报「模块未启用」）
      set((s) => ({ modulesStatus: s.modules.length ? "ok" : "error" }));
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

  moduleEnabled: (code) => {
    const mod = get().modules.find((m) => m.code === code);
    return mod?.state === "ENABLED";
  },
}));
