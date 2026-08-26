import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, SpinLoading, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { notificationApi, type NotificationItem } from "@wlt/shared";

/** 移动端可跳转的通知链接前缀（其余如删除审核在电脑端处理，仅标记已读不跳转）。 */
const MOBILE_LINK_PREFIXES = ["/requisitions/", "/stock/query"];

/* ---------- 类型语义分类（OP 设计页 M7b 改版提案）----------
 * 后端 biz_type 实际值为 预警/待办/审批/提醒 等：按语义归入四类配色，
 * 胶囊文案保留真实业务类型；筛选胶囊行按同一分类过滤（纯前端逻辑）。 */
type Cat = "warn" | "todo" | "remind" | "other";

function catOf(bizType: string): Cat {
  if (bizType === "预警") return "warn";
  if (bizType === "待办" || bizType === "审批" || bizType === "审计") return "todo";
  if (bizType === "识别" || bizType === "提醒") return "remind";
  return "other";
}

/** 分类视觉：图标块底色 / 前景色 / 胶囊类名（色值同 global.css 的 wlt-pill Token）。 */
const CAT_STYLE: Record<Cat, { tileBg: string; fg: string; pillCls: string }> = {
  warn: { tileBg: "#FDEBEC", fg: "#DC2626", pillCls: "wlt-pill--red" },
  todo: { tileBg: "#EAEFFF", fg: "#3B5BDB", pillCls: "wlt-pill--blue" },
  remind: { tileBg: "#FEF4E2", fg: "#B45309", pillCls: "wlt-pill--amber" },
  other: { tileBg: "#EFF3FC", fg: "#64748B", pillCls: "wlt-pill--gray" },
};

/** 线性小图标（viewBox 24，描边风格与 TabBar 图标一致）。 */
function LineIcon({ d, color, size = 15, strokeWidth = 1.7 }: { d: string; color: string; size?: number; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICON_D = {
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  clip: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9l2 2 4-4",
  scan: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8h.01M12 11v5",
  check: "M20 6L9 17l-5-5",
};

const CAT_ICON: Record<Cat, string> = {
  warn: ICON_D.bell,
  todo: ICON_D.clip,
  remind: ICON_D.scan,
  other: ICON_D.info,
};

/** 相对时间（OP M7b）：今天/昨天 → 「今天 HH:mm」；更早 → 「MM-DD HH:mm」。解析失败回退原始串。 */
function relTime(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(new Date()) - day0(d)) / 86400000);
  if (diff <= 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

type DayKey = "today" | "yesterday" | "early";

/** 日期分组键：今天 / 昨天 / 更早。 */
function dayKey(iso: string): DayKey {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "early";
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(new Date()) - day0(d)) / 86400000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return "early";
}

const GROUPS: Array<{ key: DayKey; label: string }> = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "early", label: "更早" },
];

type FilterKey = "all" | "unread" | Cat;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "warn", label: "预警" },
  { key: "todo", label: "待办" },
  { key: "remind", label: "提醒" },
];

/** 通知列表（手机端 TabBar 第 4 项）——按 OP 设计页 M7b 改版提案实现：
 * NavBar 右侧「全部已读 · 管理」（管理模式变为红色「完成」）；类型筛选胶囊行
 * （全部 / 未读 n / 预警 / 待办 / 提醒，按 biz_type 语义分类，管理模式下隐藏）；
 * 列表按 今天 / 昨天 / 更早 分组；通知行 = 左侧 30×30 类型图标块 + 标题（未读尾随蓝点）
 * + 内容 + 类型胶囊 + 相对时间；管理模式保留：行尾方形勾选框 + 底部「删除选中 / 全部已读」操作栏。
 * 筛选与分组均为前端逻辑（接口字段 biz_type/title/content/is_read/link/created_at 已足够）。 */
export function NotificationsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false); // 全部已读进行中（防重复点击 + 反馈）
  const [manage, setManage] = useState(false); // 管理模式（选择 + 删除）
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false); // 删除选中进行中
  const [filter, setFilter] = useState<FilterKey>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await notificationApi.list();
      setList(d.list);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    if (marking) return;
    setMarking(true);
    try {
      await notificationApi.markReadAll();
      setList((ls) => ls.map((n) => ({ ...n, is_read: 1 })));
      Toast.show("已全部标记为已读");
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    } finally {
      setMarking(false);
    }
  }

  /** 切换管理模式；退出时清空选择。 */
  function toggleManage() {
    setManage((v) => {
      const next = !v;
      if (!next) setSelected(new Set());
      return next;
    });
  }

  function toggleSelect(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const unreadCount = useMemo(() => list.filter((n) => !n.is_read).length, [list]);

  /** 当前展示集合：管理模式强制全部（筛选行隐藏）；否则按筛选胶囊过滤。 */
  const visible = useMemo(() => {
    if (manage || filter === "all") return list;
    if (filter === "unread") return list.filter((n) => !n.is_read);
    return list.filter((n) => catOf(n.biz_type) === filter);
  }, [list, filter, manage]);

  /** 按今天/昨天/更早分组（保持接口返回的时间倒序），空组不显示。 */
  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, items: visible.filter((n) => dayKey(n.created_at) === g.key) })).filter(
        (g) => g.items.length > 0
      ),
    [visible]
  );

  const allSelected = list.length > 0 && selected.size === list.length;

  /** 全选 / 取消全选（当前已加载的通知）。 */
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(list.map((n) => n.id)));
  }

  /** 一键删除选中的通知。 */
  async function deleteSelected() {
    if (!selected.size || deleting) return;
    setDeleting(true);
    try {
      const ids = [...selected];
      await notificationApi.removeMany(ids);
      setList((ls) => ls.filter((n) => !selected.has(n.id)));
      setSelected(new Set());
      if (manage && list.length === ids.length) setManage(false); // 全部删完自动退出管理模式
      Toast.show(`已删除 ${ids.length} 条通知`);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  /** 清空全部通知（确认后）。 */
  async function clearAll() {
    if (deleting) return;
    const ok = await Dialog.confirm({ content: "确定清空全部通知？此操作不可恢复。" });
    if (!ok) return;
    setDeleting(true);
    try {
      const r = await notificationApi.removeAll();
      setList([]);
      setSelected(new Set());
      setManage(false);
      Toast.show(`已清空 ${r.deleted} 条通知`);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "清空失败");
    } finally {
      setDeleting(false);
    }
  }

  /** 点击通知：管理模式=勾选；普通模式=未读先已读，链接可跳转则进入对应业务。 */
  async function onItemClick(n: NotificationItem) {
    if (manage) {
      toggleSelect(n.id);
      return;
    }
    if (!n.is_read) {
      try {
        await notificationApi.markRead(n.id);
        setList((ls) => ls.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
      } catch (e) {
        Toast.show(e instanceof Error ? e.message : "操作失败");
      }
    }
    if (n.link && MOBILE_LINK_PREFIXES.some((p) => n.link.startsWith(p))) {
      navigate(n.link);
    }
  }

  /** 方形勾选框（17×17 r5，OP Manage 样式）：管理模式行尾与「全选」共用。 */
  function SquareCheck({ checked }: { checked: boolean }) {
    return (
      <span
        style={{
          width: 17,
          height: 17,
          borderRadius: 5,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: checked ? "#3B5BDB" : "#fff",
          border: checked ? "1px solid #3B5BDB" : "1px solid #CBD6EC",
          boxSizing: "border-box",
        }}
      >
        {checked && <LineIcon d={ICON_D.check} color="#fff" size={10} strokeWidth={2.4} />}
      </span>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB", paddingBottom: manage ? 76 : 0, boxSizing: "border-box" }}>
      {/* NavBar（OP A/B：‹ 消息 · 右侧「全部已读 管理」；管理模式为红色「完成」） */}
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          background: "#fff",
          borderBottom: "1px solid #E4EAF6",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <span onClick={() => navigate("/")} style={{ fontSize: 16, fontWeight: 600, color: "#1E2433", padding: "4px 6px", cursor: "pointer" }}>
          ‹
        </span>
        <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: "#1E2433" }}>消息</span>
        {!manage && (
          <span style={{ fontSize: 12, fontWeight: 500, color: marking ? "#AAB4CC" : "#5B6478", padding: "6px 2px", cursor: marking ? "default" : "pointer" }} onClick={() => void markAllRead()}>
            全部已读
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: manage ? "#DC2626" : "#5B7FFF", padding: "6px 2px", cursor: "pointer" }} onClick={toggleManage}>
          {manage ? "完成" : "管理"}
        </span>
      </div>

      {/* 管理模式条（OP B Manage 白底 p10/14：方形勾选+全选 | 已选 n 条 · 清空全部） */}
      {manage && (
        <div
          style={{
            padding: "10px 14px",
            background: "#fff",
            borderBottom: "1px solid #E4EAF6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }} onClick={toggleAll}>
            <SquareCheck checked={allSelected} />
            <span style={{ fontSize: 12, fontWeight: 500, color: "#5B6478" }}>全选</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: "#8A93A8" }}>已选 {selected.size} 条</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#DC2626", cursor: "pointer" }} onClick={() => void clearAll()}>
              清空全部
            </span>
          </div>
        </div>
      )}

      {/* 类型筛选胶囊行（OP A FilterChips：全部(激活蓝底)/未读 n/预警/待办/提醒；管理模式隐藏） */}
      {!manage && (
        <div style={{ padding: "10px 12px 4px", display: "flex", gap: 8, overflowX: "auto" }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <span
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  borderRadius: 999,
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: active ? "#5B7FFF" : "#fff",
                  border: `1px solid ${active ? "#5B7FFF" : "#E4EAF6"}`,
                  color: active ? "#fff" : "#5B6478",
                }}
              >
                {f.label}
                {f.key === "unread" && unreadCount > 0 && (
                  <b style={{ fontSize: 11, fontWeight: 700, color: active ? "#DDE6FF" : "#5B7FFF" }}>{unreadCount}</b>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* 分组通知流（OP NRow r14 p12 gap10：图标块 + 标题[未读尾随蓝点] + 内容 + 胶囊·相对时间；
          未读=#EAEFFF 无边框 / 已读=白底 #EDF1FA 描边 / 选中=#D9E3FF） */}
      <div style={{ padding: manage ? "12px 12px" : "6px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {groups.map((g) => (
          <Fragment key={g.key}>
            <div style={{ padding: "6px 2px", fontSize: 11, fontWeight: 600, color: "#8A93A8" }}>{g.label}</div>
            {g.items.map((n) => {
              const cat = catOf(n.biz_type);
              const st = CAT_STYLE[cat];
              const checked = selected.has(n.id);
              const unread = !n.is_read;
              return (
                <div
                  key={n.id}
                  onClick={() => void onItemClick(n)}
                  style={{
                    borderRadius: 14,
                    padding: 12,
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    cursor: "pointer",
                    background: checked ? "#D9E3FF" : unread ? "#EAEFFF" : "#fff",
                    border: checked || unread ? "none" : "1px solid #EDF1FA",
                  }}
                >
                  {/* 左侧类型图标块（30×30 r9 浅底 + 15×15 线性图标） */}
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: st.tileBg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <LineIcon d={CAT_ICON[cat]} color={st.fg} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: unread ? 600 : 500, color: "#1E2433", lineHeight: 1.45 }}>
                        {n.title}
                      </span>
                      {unread && !manage && <span style={{ width: 7, height: 7, borderRadius: 4, background: "#5B7FFF", flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontSize: 11, color: "#5B6478", lineHeight: 1.5 }}>{n.content}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                      <span className={`wlt-pill ${st.pillCls}`} style={{ fontSize: 11, lineHeight: "16px", padding: "1px 9px" }}>
                        {n.biz_type || "通知"}
                      </span>
                      <span style={{ fontSize: 10, color: "#8A93A8" }}>{relTime(n.created_at)}</span>
                    </div>
                  </div>
                  {/* 管理模式行尾勾选框 */}
                  {manage && <SquareCheck checked={checked} />}
                </div>
              );
            })}
          </Fragment>
        ))}
        {loading && (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
            <SpinLoading />
          </div>
        )}
        {!loading && list.length > 0 && groups.length === 0 && (
          <div style={{ textAlign: "center", color: "#8A93A8", fontSize: 13, padding: "48px 0" }}>该分类下暂无通知</div>
        )}
        {!loading && list.length === 0 && (
          <div style={{ textAlign: "center", color: "#8A93A8", fontSize: 13, padding: "48px 0" }}>暂无通知</div>
        )}
      </div>

      {/* 管理模式底部操作栏（OP B Bar rgba(255,255,255,.95)：删除选中(红浅底) + 全部已读(白底)；
          .wlt-fixed-bar 宽屏由 widescreen.css 限宽居中） */}
      {manage && (
        <div className="wlt-fixed-bar" style={{ padding: "12px 14px", gap: 10 }}>
          <button
            onClick={() => void deleteSelected()}
            disabled={selected.size === 0 || deleting}
            style={{
              flex: 1,
              height: 38,
              borderRadius: 11,
              border: "none",
              background: "#FDEBEC",
              color: selected.size === 0 ? "#F0A6AA" : "#DC2626",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: selected.size === 0 ? "default" : "pointer",
            }}
          >
            删除选中（{selected.size}）
          </button>
          <button
            onClick={() => void markAllRead()}
            disabled={marking}
            style={{
              height: 38,
              borderRadius: 11,
              border: "1px solid #E4EAF6",
              background: "#fff",
              color: "#5B6478",
              fontSize: 12,
              fontWeight: 500,
              padding: "0 14px",
              cursor: "pointer",
            }}
          >
            全部已读
          </button>
        </div>
      )}
    </div>
  );
}
