/** 项目统一响应式断点 Hook（电脑端）：
 * ≥1024 桌面（左右主从/侧边导航）、768~1023 平板、<768 移动端（主导航与页签移到顶部）。
 */
import { useEffect, useState } from "react";

export type ViewportTier = "mobile" | "tablet" | "desktop";

export function useViewportTier(): ViewportTier {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w >= 1024 ? "desktop" : w >= 768 ? "tablet" : "mobile";
}
