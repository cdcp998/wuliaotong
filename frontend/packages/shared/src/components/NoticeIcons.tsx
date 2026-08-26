/** 站内通知分类图标（viewBox 24 线性描边风格，手机端消息页 / 桌面端通知中心共用）。
 * 颜色经 currentColor 继承自父容器（配合 NOTICE_CAT_STYLE 的 tileFg）。 */
import type { NoticeCat } from "../utils/notice";

const NOTICE_ICON_D: Record<NoticeCat, string> = {
  warn: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  todo: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9l2 2 4-4",
  remind: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10",
  other: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8h.01M12 11v5",
};

export function NoticeCatIcon({ cat, size = 15, strokeWidth = 1.7 }: { cat: NoticeCat; size?: number; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={NOTICE_ICON_D[cat]} />
    </svg>
  );
}

/** 对勾（方形勾选框选中态用）。 */
export function NoticeCheckIcon({ size = 10, strokeWidth = 2.4 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
