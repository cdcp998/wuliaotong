import { useNavigate } from "react-router-dom";

import { otherEndUrl, useAuthStore } from "@wlt/shared";

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const navigate = useNavigate();

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>物料通 · 工作台</h2>
        <div>
          <span style={{ marginRight: 12 }}>
            {user?.real_name}（{user?.role?.name}）
          </span>
          <a href={otherEndUrl("mobile")} style={{ marginRight: 12, color: "#1677ff" }}>
            手机版
          </a>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            退出登录
          </button>
        </div>
      </div>
      <p>权限点：{user?.permissions.length ?? 0} 个</p>
      <p>hasPerm("pch:in") = {String(hasPerm("pch:in"))}</p>
      <p style={{ color: "#999" }}>功能页面将在后续阶段填充（P4+）。</p>
    </div>
  );
}
