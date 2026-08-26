/** 站内通知展示辅助（手机端消息页 / 桌面端通知中心共用，OP 设计页 M7b Token 配色）。
 * 提供 biz_type 语义分类、分类配色（图标块底色 + 胶囊同系浅底）、相对时间与日期分组。 */

export type NoticeCat = "warn" | "todo" | "remind" | "other";

/** biz_type 语义分类：预警=预警；待办=待办/审批/审计；提醒=提醒/识别；其余归其他。文案保留真实业务类型。 */
export function noticeCatOf(bizType: string): NoticeCat {
  if (bizType === "预警") return "warn";
  if (bizType === "待办" || bizType === "审批" || bizType === "审计") return "todo";
  if (bizType === "识别" || bizType === "提醒") return "remind";
  return "other";
}

/** 分类视觉：左侧 30×30 图标块底色/前景色 + 类型胶囊同系浅底（OP M7b 规格）。 */
export const NOTICE_CAT_STYLE: Record<NoticeCat, { tileBg: string; tileFg: string; pillBg: string; pillFg: string }> = {
  warn: { tileBg: "#FDEBEC", tileFg: "#DC2626", pillBg: "#FDEBEC", pillFg: "#DC2626" },
  todo: { tileBg: "#EAEFFF", tileFg: "#3B5BDB", pillBg: "#EAEFFF", pillFg: "#5B7FFF" },
  remind: { tileBg: "#FEF4E2", tileFg: "#B45309", pillBg: "#FEF4E2", pillFg: "#B45309" },
  other: { tileBg: "#EFF3FC", tileFg: "#64748B", pillBg: "#EFF3FC", pillFg: "#64748B" },
};

function _parsed(iso: string): Date | null {
  const d = new Date(iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function _day0(x: Date): number {
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
}

/** 相对时间（OP M7b）：今天/昨天 → 「今天 HH:mm」；更早 → 「MM-DD HH:mm」；解析失败回退原始串。 */
export function noticeRelTime(iso: string): string {
  const d = _parsed(iso);
  if (!d) return iso.slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diff = Math.round((_day0(new Date()) - _day0(d)) / 86400000);
  if (diff <= 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

export type NoticeDayKey = "today" | "yesterday" | "early";

/** 日期分组键：今天 / 昨天 / 更早（解析失败归更早）。 */
export function noticeDayKey(iso: string): NoticeDayKey {
  const d = _parsed(iso);
  if (!d) return "early";
  const diff = Math.round((_day0(new Date()) - _day0(d)) / 86400000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return "early";
}

/** 分组渲染顺序与组头文案。 */
export const NOTICE_DAY_GROUPS: Array<{ key: NoticeDayKey; label: string }> = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "early", label: "更早" },
];
