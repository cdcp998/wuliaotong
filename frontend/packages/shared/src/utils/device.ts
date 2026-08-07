/** 设备检测与跨端跳转（《前端设计.md》入口页设计）。
 *
 * 入口偏好：用户手动选择一端后写入 localStorage（wlt_entry），之后 Landing
 * 不再按设备自动跳转——**用户选择优先级大于系统判断**；clearEntryPreference 可恢复自动检测。
 */

export type DeviceKind = "mobile" | "tablet" | "desktop";

export type EntryKind = "desktop" | "mobile";

const ENTRY_KEY = "wlt_entry";

/** 记录用户手动选择的端（优先级高于设备检测）。 */
export function setEntryPreference(kind: EntryKind): void {
  try {
    localStorage.setItem(ENTRY_KEY, kind);
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export function getEntryPreference(): EntryKind | null {
  try {
    const v = localStorage.getItem(ENTRY_KEY);
    return v === "desktop" || v === "mobile" ? v : null;
  } catch {
    return null;
  }
}

export function clearEntryPreference(): void {
  try {
    localStorage.removeItem(ENTRY_KEY);
  } catch {
    /* ignore */
  }
}

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
 * 另一端入口地址（直达登录页，避免再经过 Landing 设备检测形成循环）。
 * 开发环境：同主机换端口（电脑 5173 / 手机 5174），跟随当前 hostname，
 *   兼容 localhost / 局域网 IP（如手机访问 http://192.168.1.5:5173）/ 自定义域名；
 * 生产环境：Nginx 反向代理按路径分发——电脑端 /login、手机端 /m/login（mobile 构建 base=/m/）。
 */
export function otherEndUrl(kind: "desktop" | "mobile"): string {
  const { protocol, hostname } = window.location;
  if (import.meta.env.DEV) {
    const targetPort = kind === "mobile" ? 5175 : 5174; // 开发：电脑 5174 / 手机 5175
    return `${protocol}//${hostname}:${targetPort}/login`;
  }
  return kind === "mobile" ? "/m/login" : "/login";
}

/** 电脑端初始化安装页地址（系统未初始化时手机端整页跳转用）。 */
export function otherEndInitUrl(): string {
  return otherEndUrl("desktop").replace(/\/login$/, "/init");
}
