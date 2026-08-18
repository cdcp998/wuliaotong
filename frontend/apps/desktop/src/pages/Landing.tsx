import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Button, theme } from "antd";

import { detectDevice, getEntryPreference, initApi, otherEndUrl, setEntryPreference, useAuthStore } from "@wlt/shared";

/** 入口页：未初始化强制跳初始化安装页；已初始化按设备类型自动跳转（手机/平板 → 手机版登录页），并提供手动切换。
 *
 * 优先级：初始化状态 > 用户手动选择（localStorage wlt_entry）> 已登录 > 设备检测；
 * 用户选择一端后不再自动跳转，避免手机点"电脑版入口"又被弹回手机版。
 */
export function LandingPage() {
  const navigate = useNavigate();
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const { token } = theme.useToken();

  useEffect(() => {
    let alive = true;
    // 先查初始化状态：未初始化 → 初始化安装页；状态接口异常不阻塞入口
    initApi
      .status()
      .then((st) => {
        if (alive && !st.initialized) {
          navigate("/init", { replace: true });
          return false;
        }
        return true;
      })
      .catch(() => true)
      .then((proceed) => {
        if (!alive || !proceed) return;
        const pref = getEntryPreference();
        if (pref === "mobile") {
          window.location.replace(otherEndUrl("mobile"));
          return;
        }
        if (pref === "desktop") {
          navigate("/login", { replace: true });
          return;
        }
        fetchMe()
          .then(() => navigate("/app", { replace: true })) // 已登录 → 主页
          .catch(() => {
            const kind = detectDevice();
            if (kind === "mobile" || kind === "tablet") {
              window.location.replace(otherEndUrl("mobile"));
            } else {
              navigate("/login", { replace: true });
            }
          });
      });
    return () => {
      alive = false;
    };
  }, [navigate, fetchMe]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: token.colorBgLayout,
        gap: 24,
        padding: 24,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: token.colorPrimary,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          fontWeight: 700,
          boxShadow: `0 8px 20px rgba(22, 104, 220, 0.28)`,
        }}
      >
        物
      </div>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em" }}>物料通管理系统</h2>
      <p style={{ color: token.colorTextSecondary, margin: "8px 0 0" }}>正在识别设备类型，自动跳转…</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <Button
          type="primary"
          size="large"
          onClick={() => {
            setEntryPreference("desktop");
            navigate("/login");
          }}
        >
          进入电脑版
        </Button>
        <Button size="large" href={otherEndUrl("mobile")} onClick={() => setEntryPreference("mobile")}>
          进入手机版
        </Button>
      </div>
    </div>
  );
}
