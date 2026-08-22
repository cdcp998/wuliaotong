import { useEffect, type ReactNode } from "react";
import { Button, NavBar } from "antd-mobile";
import { useNavigate } from "react-router";

import { initApi, otherEndInitUrl, useAuthStore } from "@wlt/shared";

/**
 * 路由守卫：未初始化整页跳电脑端初始化安装页；未登录跳 /login。
 * perm 可选（逗号分隔=任一命中即可）：有权限点控制的功能页必须经此守卫，无权限显示
 * 「无权限访问」视图（带返回键），避免直接输 URL 绕过显示层（《前端设计.md》§6）。
 */
export function RequireAuth({ children, perm }: { children: ReactNode; perm?: string }) {
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const hasPerm = useAuthStore((s) => s.hasPerm);
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

  // 权限校验：逗号分隔 = 任一命中即可；super_admin 由 hasPerm 内部放行
  if (perm) {
    const codes = perm
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowed = codes.length === 0 || codes.some((c) => hasPerm(c));
    if (!allowed) {
      return (
        <div style={{ minHeight: "100dvh", background: "#f5f6f8" }}>
          <NavBar onBack={() => navigate("/")}>功能</NavBar>
          <div style={{ padding: "72px 40px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1f2329" }}>无权限访问</div>
            <div style={{ fontSize: 12.5, color: "#646a73", margin: "8px 0 24px", lineHeight: 1.7 }}>
              当前账号没有使用该功能的权限，请联系管理员在「用户权限设置」中授权。
            </div>
            <Button block color="primary" style={{ height: 42, borderRadius: 9, maxWidth: 240, margin: "0 auto" }} onClick={() => navigate("/")}>
              返回首页
            </Button>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
