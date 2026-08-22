import { useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { initApi, useAuthStore, type MenuNode } from "@wlt/shared";

import { MENU } from "./AppLayout";

/** 拍平菜单树 → {path, perm} 叶子列表（动态菜单优先，硬编码 MENU 兜底）。 */
function menuLeaves(menus: MenuNode[]): { path: string; perm: string }[] {
  const out: { path: string; perm: string }[] = [];
  const walk = (ns: MenuNode[]) => {
    for (const n of ns) {
      if (n.children?.length) walk(n.children);
      else if (n.path) out.push({ path: n.path, perm: n.perm_code });
    }
  };
  walk(menus);
  return out;
}

/** 路由守卫：未初始化跳 /init；未登录跳 /login；已登录但无当前页面权限时回入口（《前端设计.md》§6）。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const menus = useAuthStore((s) => s.menus);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const fetchModules = useAuthStore((s) => s.fetchModules);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const hasAnyPerm = useAuthStore((s) => s.hasAnyPerm);
  const navigate = useNavigate();
  const location = useLocation();

  // 当前路径所需权限（取最长前缀匹配的菜单项；perm 逗号分隔=任一命中即可进；无 perm=公开）
  const requiredPerm = useMemo(() => {
    let best: { perm: string | undefined; len: number } | undefined;
    const leaves = menus.length ? menuLeaves(menus) : [];
    if (leaves.length) {
      for (const l of leaves) {
        if (l.perm && location.pathname.startsWith(l.path)) {
          if (!best || l.path.length > best.len) best = { perm: l.perm, len: l.path.length };
        }
      }
    } else {
      for (const g of MENU) {
        for (const c of g.children ?? []) {
          if (c.perm && location.pathname.startsWith(c.key)) {
            const perm = Array.isArray(c.perm) ? c.perm.join(",") : c.perm;
            if (!best || c.key.length > best.len) best = { perm, len: c.key.length };
          }
        }
      }
    }
    return best?.perm;
  }, [location.pathname, menus]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 未初始化 → 初始化安装页（先于登录流程，避免与 fetchMe 跳转竞争）
      try {
        const st = await initApi.status();
        if (alive && !st.initialized) {
          navigate("/init", { replace: true });
          return;
        }
      } catch {
        /* 状态接口异常不阻塞登录校验 */
      }
      if (alive && !user) {
        fetchMe()
          .then(() => {
            if (alive) void fetchModules(); // 刷新后立即拉模块状态（RequireModule 守卫防误报）
          })
          .catch(() => {
            if (alive) navigate("/login");
          });
      } else if (alive) {
        void fetchModules();
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, fetchMe, fetchModules, navigate]);

  useEffect(() => {
    if (user && requiredPerm) {
      const codes = requiredPerm.split(",").map((c) => c.trim()).filter(Boolean);
      const ok = codes.length === 1 ? hasPerm(codes[0]) : hasAnyPerm(codes);
      if (!ok) {
        navigate("/", { replace: true }); // 无权限：回入口（Landing 按角色展示可选功能）
      }
    }
  }, [user, requiredPerm, hasPerm, hasAnyPerm, navigate]);

  if (!user) return null;
  return <>{children}</>;
}
