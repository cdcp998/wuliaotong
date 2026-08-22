/** 手机端模块守卫：区分「加载中 / 加载失败（可重试）/ 确认未启用」。
 * 解决刷新瞬间模块状态未拉取导致误报「模块未启用」的问题（与桌面端 RequireModule 行为一致）。 */
import { Button, DotLoading, NavBar } from "antd-mobile";
import { useNavigate } from "react-router";

import { useAuthStore } from "@wlt/shared";

export function ModuleGate({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const modulesStatus = useAuthStore((s) => s.modulesStatus);
  const fetchModules = useAuthStore((s) => s.fetchModules);

  if (modulesStatus === "idle" || modulesStatus === "loading") {
    return (
      <div style={{ minHeight: "70dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#5B6478" }}>
        <NavBar onBack={() => navigate(-1)}>{title}</NavBar>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24 }}>
          <DotLoading /> 正在加载模块状态…
        </div>
      </div>
    );
  }
  if (modulesStatus === "error") {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#999" }}>
        <NavBar onBack={() => navigate(-1)}>{title}</NavBar>
        <p>模块状态加载失败（网络/接口异常）。</p>
        <Button size="small" color="primary" fill="outline" onClick={() => void fetchModules()}>重新加载</Button>
      </div>
    );
  }
  if (!moduleEnabled(code)) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#999" }}>
        <NavBar onBack={() => navigate(-1)}>{title}</NavBar>
        <p>「{title}」模块未启用，请先由管理员在电脑端安装并启用。</p>
      </div>
    );
  }
  return <>{children}</>;
}
