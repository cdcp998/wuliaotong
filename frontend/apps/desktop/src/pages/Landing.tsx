import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { detectDevice, getEntryPreference, otherEndUrl, setEntryPreference, useAuthStore } from "@wlt/shared";

/** 入口页：按设备类型自动跳转（手机/平板 → 手机版登录页），并提供手动切换。
 *
 * 优先级：用户手动选择（localStorage wlt_entry）> 已登录 > 设备检测；
 * 用户选择一端后不再自动跳转，避免手机点"电脑版入口"又被弹回手机版。
 */
export function LandingPage() {
  const navigate = useNavigate();
  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => {
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
  }, [navigate, fetchMe]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#f0f2f5",
        gap: 20,
      }}
    >
      <h2 style={{ margin: 0 }}>物料通管理系统</h2>
      <p style={{ color: "#999" }}>正在识别设备类型，自动跳转…</p>
      <div style={{ display: "flex", gap: 12 }}>
        <button
          style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#1677ff", color: "#fff", fontSize: 15, cursor: "pointer" }}
          onClick={() => {
            setEntryPreference("desktop");
            navigate("/login");
          }}
        >
          进入电脑版
        </button>
        <a
          href={otherEndUrl("mobile")}
          onClick={() => setEntryPreference("mobile")}
          style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1677ff", color: "#1677ff", fontSize: 15, textDecoration: "none" }}
        >
          进入手机版
        </a>
      </div>
    </div>
  );
}
