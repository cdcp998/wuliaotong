import { useCallback, useEffect, useState } from "react";
import { Checkbox, Dialog, SpinLoading, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { notificationApi, type NotificationItem } from "@wlt/shared";

/** 通知类型胶囊（OP M7：审计=蓝 / 预警=红 / 识别=琥珀）。
 * 后端 biz_type 实际值为 预警/待办/审批/提醒 等：按语义映射配色，文案保留真实业务类型。 */
function bizPill(t: string): { label: string; cls: string } {
  if (t === "预警") return { label: t, cls: "wlt-pill--red" };
  if (t === "待办" || t === "审批" || t === "审计") return { label: t, cls: "wlt-pill--blue" };
  if (t === "识别" || t === "提醒") return { label: t, cls: "wlt-pill--amber" };
  return { label: t || "通知", cls: "wlt-pill--gray" };
}

/** 移动端可跳转的通知链接前缀（其余如删除审核在电脑端处理，仅标记已读不跳转）。 */
const MOBILE_LINK_PREFIXES = ["/requisitions/", "/stock/query"];

/** 通知列表（手机端 TabBar 第 4 项）——OP 规格（设计页 M7）：
 * NavBar 右侧「管理」；管理模式条（全选/已选 n 条·清空全部）；卡片行 r14 p12 gap10
 * （未读=品牌浅底+蓝点，已读=白底+灰点；标题 12.5 + 内容 11 + 类型胶囊 + 时间）；
 * 管理模式底部操作栏（删除选中(红) + 全部已读）。点击业务通知跳转对应单据并自动已读。 */
export function NotificationsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false); // 全部已读进行中（防重复点击 + 反馈）
  const [manage, setManage] = useState(false); // 管理模式（选择 + 删除）
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false); // 删除选中进行中

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

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB", paddingBottom: manage ? 76 : 0, boxSizing: "border-box" }}>
      {/* NavBar（OP：‹ 通知 · 右侧「管理」） */}
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          background: "#fff",
          borderBottom: "1px solid #F2F5FB",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <span onClick={() => navigate("/")} style={{ fontSize: 16, fontWeight: 600, color: "#1E2433", padding: "4px 6px", cursor: "pointer" }}>
          ‹
        </span>
        <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: "#1E2433" }}>通知</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: manage ? "#DC2626" : "#5B7FFF", padding: "6px 2px", cursor: "pointer" }} onClick={toggleManage}>
          {manage ? "完成" : "管理"}
        </span>
      </div>

      {/* 管理模式条（OP Manage 白底 p12/14：全选 + 已选 n 条 · 清空全部） */}
      {manage && (
        <div
          style={{
            padding: "12px 14px",
            background: "#fff",
            borderBottom: "1px solid #E4EAF6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={toggleAll}>
            <Checkbox checked={allSelected} style={{ "--icon-size": "16px" } as React.CSSProperties} />
            <span style={{ fontSize: 12, color: "#5B6478" }}>全选</span>
          </div>
          <span style={{ fontSize: 11, color: "#8A93A8", display: "flex", alignItems: "center" }}>
            已选 {selected.size} 条
            <span style={{ color: "#3B5BDB", marginLeft: 12 }} onClick={() => void clearAll()}>
              清空全部
            </span>
          </span>
        </div>
      )}

      {/* 通知卡流（OP NRow r14 p12 gap10；未读品牌浅底 + 蓝点 / 已读白底 + 灰点） */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((n) => {
          const pill = bizPill(n.biz_type);
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
                cursor: "pointer",
                background: checked ? "#D9E3FF" : unread ? "#EAEFFF" : "#fff",
                border: unread ? "none" : "1px solid #EDF1FA",
              }}
            >
              {/* 圆点 / 勾选框 */}
              {manage ? (
                <Checkbox checked={checked} style={{ "--icon-size": "17px", marginTop: 2 } as React.CSSProperties} />
              ) : (
                <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0, background: unread ? "#5B7FFF" : "#CBD6EC" }} />
              )}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 12.5, fontWeight: unread ? 600 : 500, color: "#1E2433", lineHeight: 1.45 }}>{n.title}</div>
                <div style={{ fontSize: 11, color: "#5B6478", lineHeight: 1.5 }}>{n.content}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                  <span className={`wlt-pill ${pill.cls}`} style={{ fontSize: 12, lineHeight: "18px", padding: "1px 10px" }}>
                    {pill.label}
                  </span>
                  <span style={{ fontSize: 10, color: "#8A93A8" }}>{n.created_at.slice(0, 16).replace("T", " ")}</span>
                </div>
              </div>
            </div>
          );
        })}
        {loading && (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
            <SpinLoading />
          </div>
        )}
        {!loading && list.length === 0 && (
          <div style={{ textAlign: "center", color: "#8A93A8", fontSize: 13, padding: "48px 0" }}>暂无通知</div>
        )}
      </div>

      {/* 管理模式底部操作栏（OP Bar rgba(255,255,255,.95)：删除选中(红浅底) + 全部已读(白底)；
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
