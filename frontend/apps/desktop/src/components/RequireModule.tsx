import { Button, Result } from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { useAuthStore } from "@wlt/shared";

/** 模块路由守卫（线缆和设备插件方案 §2.3）：模块未启用时渲染「模块未启用」占位。
 * 模块状态由 useAuthStore.modules 提供（AppLayout 登录后拉取；无 module:manage 权限时静默为空，
 * 此时按未启用处理——管理员登录后模块列表正常加载）。 */
export function RequireModule({ code, children }: { code: string; children: ReactNode }) {
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
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
