import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@wlt/shared";

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>物料通</h2>
        <button
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          退出
        </button>
      </div>
      <p style={{ color: "#666" }}>
        {user?.real_name}（{user?.role?.name}）
      </p>
      <p style={{ color: "#999" }}>领用申请等功能页面将在后续阶段填充。</p>
    </div>
  );
}
