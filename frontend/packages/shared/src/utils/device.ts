/** 设备检测与跨端跳转（《前端设计.md》入口页设计）。 */

export type DeviceKind = "mobile" | "tablet" | "desktop";

export function detectDevice(): DeviceKind {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  // 平板：iPad/Android 非 Mobile 标记
  const isTablet =
    /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  if (isTablet) return "tablet";
  const isMobile = /Android|iPhone|iPod|Opera Mini|IEMobile|WPDesktop/i.test(ua);
  return isMobile ? "mobile" : "desktop";
}

/**
 * 另一端入口地址。
 * 开发环境：电脑端 5173 / 手机端 5174（独立端口，无前缀）；
 * 生产环境：电脑端 / 、手机端 /m/（Nginx 按前缀分发，mobile 构建 base=/m/）。
 */
export function otherEndUrl(kind: "desktop" | "mobile"): string {
  if (import.meta.env.DEV) {
    return kind === "mobile" ? "http://localhost:5174" : "http://localhost:5173";
  }
  return kind === "mobile" ? "/m/" : "/";
}
