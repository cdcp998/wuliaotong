/** 手机端功能清单（首页快捷操作与「功能」Tab 共用的单一数据源）。
 * 快捷操作偏好：每用户 localStorage 存「已隐藏」的功能 key 集合；
 * 「功能」页可一键把功能加入/移出首页快捷操作（写入同一集合）。 */

export interface MobileFunction {
  key: string;
  title: string;
  sub: string;
  path: string;
  perm: string;
  icon: React.ReactNode;
}

const stroke = (path: React.ReactNode, filled = false) => (
  <svg viewBox="0 0 24 24" width={22} height={22} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

/** 手机端全部功能（权限码过滤在页面层做；perm 空 = 所有人可见）。 */
export const FUNCTIONS: MobileFunction[] = [
  {
    key: "apply",
    title: "领用申请",
    sub: "扫码加料",
    path: "/requisitions/new",
    perm: "req:apply",
    icon: stroke(<><path d="M12 3v18M3 12h18" /></>),
  },
  {
    key: "stock",
    title: "库存查询",
    sub: "扫码快查",
    path: "/stock/query",
    perm: "stk:query",
    icon: stroke(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>),
  },
  {
    key: "scan",
    title: "拍照识别",
    sub: "OCR 快查",
    path: "/ocr/scan",
    perm: "ocr:use",
    icon: stroke(<><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="10" height="10" rx="2" /></>),
  },
  {
    key: "mine-req",
    title: "我的申请",
    sub: "进度留痕",
    path: "/requisitions/list",
    perm: "req:apply",
    icon: stroke(<><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  },
  {
    key: "req-audit",
    title: "领用审计",
    sub: "通过/驳回",
    path: "/requisitions/audit",
    perm: "req:audit",
    icon: stroke(<><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  },
  {
    key: "warehouses",
    title: "仓库与货架",
    sub: "库位库存",
    path: "/warehouses",
    perm: "base:warehouse",
    icon: stroke(<><path d="M3 21V8l9-5 9 5v13" /><path d="M3 21h18" /><path d="M9 21v-6h6v6" /></>),
  },
  {
    key: "transfers",
    title: "库存调拨",
    sub: "调仓转库",
    path: "/transfers",
    perm: "stk:transfer",
    icon: stroke(<><path d="M4 17h13M13 13l4 4-4 4" /><path d="M20 7H7M11 3l-4 4 4 4" /></>),
  },
  {
    key: "inbound",
    title: "入库",
    sub: "拍照留底",
    path: "/inbound",
    perm: "pch:in",
    icon: stroke(<><path d="M12 3v18M3 12h18" /></>),
  },
  {
    key: "outbound",
    title: "其他出库",
    sub: "报废/赠品",
    path: "/outbound",
    perm: "stk:other",
    icon: stroke(<><path d="M12 3v18M5 12h14" /></>),
  },
  {
    key: "checks",
    title: "库存盘点",
    sub: "录实盘",
    path: "/checks",
    perm: "stk:check",
    icon: stroke(<><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  },
  {
    key: "notify",
    title: "通知",
    sub: "预警/审批",
    path: "/notifications",
    perm: "",
    icon: stroke(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>),
  },
];

/** 每用户首页快捷操作「已隐藏」集合的 localStorage key。 */
export function homeHiddenKey(userId: number): string {
  return `wlt.mobile.home.actions.${userId}`;
}

export function loadHomeHidden(userId: number): Set<string> {
  try {
    const raw = localStorage.getItem(homeHiddenKey(userId));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* 损坏数据按空处理 */
  }
  return new Set();
}

export function saveHomeHidden(userId: number, hidden: Set<string>): void {
  try {
    localStorage.setItem(homeHiddenKey(userId), JSON.stringify([...hidden]));
  } catch {
    /* 存储不可用时仅本次生效 */
  }
}

/** 每用户功能「显示顺序」（首页快捷操作与功能页共用同一份；编辑模式 ▲▼ 调整）。 */
export function homeOrderKey(userId: number): string {
  return `wlt.mobile.home.order.${userId}`;
}

export function loadHomeOrder(userId: number): string[] {
  try {
    const raw = localStorage.getItem(homeOrderKey(userId));
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return arr.filter((k): k is string => typeof k === "string");
    }
  } catch {
    /* 损坏数据按空处理 */
  }
  return [];
}

export function saveHomeOrder(userId: number, order: string[]): void {
  try {
    localStorage.setItem(homeOrderKey(userId), JSON.stringify(order));
  } catch {
    /* 存储不可用时仅本次生效 */
  }
}

/** 合并顺序：保留已存顺序 + 把未包含的新功能追加到末尾（保证顺序数组覆盖全部功能）。 */
export function mergeOrder(order: string[], keys: string[]): string[] {
  const known = order.filter((k) => keys.includes(k));
  const missing = keys.filter((k) => !known.includes(k));
  return [...known, ...missing];
}

/** 按共享顺序排序（不在顺序里的放最后，保持原相对顺序；Array.sort 稳定）。 */
export function sortByOrder<T extends { key: string }>(items: T[], order: string[]): T[] {
  const idx = new Map(order.map((k, i) => [k, i]));
  return [...items].sort((a, b) => (idx.get(a.key) ?? 1e9) - (idx.get(b.key) ?? 1e9));
}

/** 仅重排「可见子集」在完整顺序中的相对位置（不可见键保持原位），用于拖拽排序后合并回完整顺序。 */
export function reorderVisible(order: string[], visibleKeys: string[], newVisibleKeys: string[]): string[] {
  const visibleSet = new Set(visibleKeys);
  const seq = newVisibleKeys.filter((k) => visibleSet.has(k));
  const out: string[] = [];
  let vi = 0;
  for (const k of order) {
    if (visibleSet.has(k)) {
      out.push(seq[vi] ?? k);
      vi++;
    } else {
      out.push(k);
    }
  }
  return out;
}
