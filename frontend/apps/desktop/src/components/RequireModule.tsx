import { Button, Result, Spin } from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { useAuthStore } from "@wlt/shared";

/** 模块路由守卫（线缆和设备插件方案 §2.3）。
 *
 * 状态区分（2026-08-22 修复刷新误报）：
 * - 模块状态拉取中 → 转圈（不渲染「未启用」，避免刷新瞬间误报）
 * - 拉取失败 → 「加载失败 + 重试」（仅当已有数据才判定真实状态；不误导管理员去安装）
 * - 已加载且确实未启用 → 「模块未启用」占位（跳安装模块页）
 */
export function RequireModule({ code, children }: { code: string; children: ReactNode }) {
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const modulesStatus = useAuthStore((s) => s.modulesStatus);
  const fetchModules = useAuthStore((s) => s.fetchModules);

  if (modulesStatus === "idle" || modulesStatus === "loading") {
    return (
      <div style={{ minHeight: "40dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spin tip="正在加载模块状态…" />
      </div>
    );
  }
  if (modulesStatus === "error") {
    return (
      <Result
        status="warning"
        title="模块状态加载失败"
        subTitle="无法获取模块启用状态（网络/接口异常），请重试；若持续失败请联系管理员检查后端服务。"
        extra={<Button type="primary" onClick={() => void fetchModules()}>重新加载</Button>}
      />
    );
  }
  if (!moduleEnabled(code)) {
    return (
      <Result
        status="warning"
        title="模块未启用"
        subTitle={`功能模块「${code}」当前未启用。请联系超级管理员在「系统管理 → 安装模块」中安装并启用后再使用。`}
        extra={
          <Link to="/system/modules">
            <Button type="primary">前往安装模块</Button>
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}
