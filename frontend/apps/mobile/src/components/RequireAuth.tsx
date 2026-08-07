import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { initApi, otherEndInitUrl, useAuthStore } from "@wlt/shared";

/** 路由守卫：未初始化整页跳电脑端初始化安装页；未登录跳 /login（《前端设计.md》§6）。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      // 未初始化 → 电脑端初始化安装页（先于登录流程，避免与 fetchMe 跳转竞争）
      try {
        const st = await initApi.status();
        if (alive && !st.initialized) {
          window.location.replace(otherEndInitUrl());
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

  if (!user) return null;
  return <>{children}</>;
}
