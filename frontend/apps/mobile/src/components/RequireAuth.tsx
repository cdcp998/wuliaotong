import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@wlt/shared";

/** 路由守卫：未登录跳 /login（《前端设计.md》§6）。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      fetchMe().catch(() => navigate("/login"));
    }
  }, [user, fetchMe, navigate]);

  if (!user) return null;
  return <>{children}</>;
}
