import { Button, Grid } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { otherEndUrl, useAuthStore } from "@wlt/shared";

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const navigate = useNavigate();

  const isKeeper = hasPerm("pch:in") || hasPerm("stk:check") || hasPerm("stk:other");
  const isApplicant = hasPerm("req:apply");

  return (
    <div style={{ padding: 16, minHeight: "100vh", background: "#f5f6f8" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>物料通</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href={otherEndUrl("desktop")} style={{ color: "#1677ff", fontSize: 13 }}>
            电脑版
          </a>
          <button
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          退出
        </button>
        </div>
      </div>
      <p style={{ color: "#666" }}>
        {user?.real_name}（{user?.role?.name}）
      </p>

      <Grid columns={2} gap={12} style={{ marginTop: 8 }}>
        {isApplicant && (
          <>
            <Grid.Item>
              <Button block color="primary" onClick={() => navigate("/requisitions/new")}>
                领用申请
              </Button>
            </Grid.Item>
            <Grid.Item>
              <Button block fill="outline" color="primary" onClick={() => navigate("/requisitions/list")}>
                我的申请
              </Button>
            </Grid.Item>
          </>
        )}
        {hasPerm("pch:in") && (
          <Grid.Item>
            <Button block color="success" onClick={() => navigate("/inbound")}>
              采购入库
            </Button>
          </Grid.Item>
        )}
        {hasPerm("stk:other") && (
          <Grid.Item>
            <Button block color="warning" onClick={() => navigate("/outbound")}>
              其他出库
            </Button>
          </Grid.Item>
        )}
        {hasPerm("stk:check") && (
          <Grid.Item>
            <Button block color="primary" fill="outline" onClick={() => navigate("/checks")}>
              库存盘点
            </Button>
          </Grid.Item>
        )}
        {hasPerm("stk:query") && (
          <Grid.Item>
            <Button block fill="outline" onClick={() => navigate("/stock/query")}>
              库存查询
            </Button>
          </Grid.Item>
        )}
      </Grid>

      {!isKeeper && !isApplicant && (
        <p style={{ color: "#999", marginTop: 16 }}>当前角色暂无操作入口，请联系管理员。</p>
      )}
    </div>
  );
}
