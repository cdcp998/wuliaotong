import { useEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { initApi, useAuthStore } from "@wlt/shared";

import { MENU } from "./AppLayout";

/** 路由守卫：未初始化跳 /init；未登录跳 /login；已登录但无当前页面权限时回入口（《前端设计.md》§6）。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const navigate = useNavigate();
  const location = useLocation();

  // 当前路径所需权限（取最长前缀匹配的菜单项）
  const requiredPerm = useMemo(() => {
    let best: string | undefined;
    for (const g of MENU) {
      for (const c of g.children ?? []) {
        if (c.perm && location.pathname.startsWith(c.key)) {
          if (!best || c.key.length > best.length) best = c.perm;
        }
      }
    }
    return best;
  }, [location.pathname]);

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
        fetchMe().catch(() => {
          if (alive) navigate("/login");
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, fetchMe, navigate]);

  useEffect(() => {
    if (user && requiredPerm && !hasPerm(requiredPerm)) {
      navigate("/", { replace: true }); // 无权限：回入口（Landing 按角色展示可选功能）
    }
  }, [user, requiredPerm, hasPerm, navigate]);

  if (!user) return null;
  return <>{children}</>;
}
