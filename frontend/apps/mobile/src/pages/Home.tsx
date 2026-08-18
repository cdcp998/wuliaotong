import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Badge, Tag } from "antd-mobile";

import { notificationApi, requisitionApi, useAuthStore, type RequisitionBill } from "@wlt/shared";

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待完成工作", color: "warning" },
  2: { text: "待审计", color: "primary" },
  3: { text: "已完成", color: "success" },
  4: { text: "已驳回", color: "danger" },
  5: { text: "已取消", color: "default" },
};

const stroke = (path: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

interface Action {
  key: string;
  title: string;
  sub: string;
  path: string;
  perm: string;
  icon: React.ReactNode;
}

const ACTIONS: Action[] = [
  { key: "apply", title: "领用申请", sub: "扫码加料", path: "/requisitions/new", perm: "req:apply", icon: stroke(<><path d="M12 3v18M3 12h18" /></>) },
  { key: "stock", title: "库存查询", sub: "扫码快查", path: "/stock/query", perm: "stk:query", icon: stroke(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>) },
  { key: "scan", title: "拍照识别", sub: "OCR 快查", path: "/ocr/scan", perm: "ocr:use", icon: stroke(<><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="10" height="10" rx="2" /></>) },
  { key: "mine-req", title: "我的申请", sub: "进度留痕", path: "/requisitions/list", perm: "req:apply", icon: stroke(<><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>) },
  { key: "inbound", title: "入库", sub: "拍照留底", path: "/inbound", perm: "pch:in", icon: stroke(<><path d="M12 3v18M3 12h18" /></>) },
  { key: "outbound", title: "其他出库", sub: "报废/赠品", path: "/outbound", perm: "stk:other", icon: stroke(<><path d="M12 3v18M5 12h14" /></>) },
  { key: "checks", title: "库存盘点", sub: "录实盘", path: "/checks", perm: "stk:check", icon: stroke(<><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>) },
  { key: "notify", title: "通知", sub: "预警/审批", path: "/notifications", perm: "", icon: stroke(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>) },
];

/** 手机端首页工作台（TabBar 第 1 项）：hero + 快捷宫格 + 我的申请状态 + 通知摘要（《UI设计方案.md》§5.2）。
 * 快捷宫格支持编辑（长按/点「编辑」）：按用户隐藏不常用功能，偏好保存在本机 localStorage。 */
export function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [unread, setUnread] = useState(0);
  const [reqs, setReqs] = useState<RequisitionBill[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const isSuper = user?.role?.code === "super_admin";
  const visibleActions = ACTIONS.filter((a) => !a.perm || hasPerm(a.perm) || isSuper);
  const gridActions = visibleActions.filter((a) => !hidden.has(a.key));

  // 每用户的本机宫格偏好（仅隐藏集，不随权限变化丢失）
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(`wlt.mobile.home.actions.${user.id}`);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* 忽略损坏数据 */
    }
  }, [user?.id]);

  function toggleHidden(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      if (user) {
        try {
          localStorage.setItem(`wlt.mobile.home.actions.${user.id}`, JSON.stringify([...next]));
        } catch {
          /* 存储不可用时仅本次生效 */
        }
      }
      return next;
    });
  }

  useEffect(() => {
    notificationApi.unreadCount().then((d) => setUnread(d.unread_count)).catch(() => undefined);
    requisitionApi
      .my(undefined, 1)
      .then((d) => setReqs(d.list.slice(0, 3)))
      .catch(() => undefined);
  }, []);

  return (
    <div style={{ padding: 12, paddingBottom: 8 }}>
      {/* Hero 问候条（主色纯色底，不用渐变，《UI设计方案.md》§2.1） */}
      <div
        style={{
          background: "#1668dc",
          borderRadius: 12,
          padding: 16,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -34,
            top: -40,
            width: 130,
            height: 130,
            borderRadius: "50%",
            border: "18px solid rgba(255,255,255,.10)",
          }}
        />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>你好，{user?.real_name}</div>
          <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 3 }}>
            {user?.role?.name} · {unread > 0 ? `${unread} 条未读通知` : "暂无未读通知"}
          </div>
        </div>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: "rgba(255,255,255,.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          onClick={() => navigate("/notifications")}
        >
          <Badge content={unread} style={{ "--right": "-4px", "--top": "-4px" } as React.CSSProperties}>
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="#fff" strokeWidth={1.8}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          </Badge>
        </div>
      </div>

      {/* 快捷操作宫格（按权限过滤，触屏 ≥44px；可编辑：隐藏/恢复常用功能） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1f2329" }}>快捷操作</span>
        <span
          style={{ fontSize: 12, color: editMode ? "#1668dc" : "#646a73", cursor: "pointer", padding: "4px 2px" }}
          onClick={() => setEditMode((v) => !v)}
        >
          {editMode ? "完成" : "编辑"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
        {(editMode ? visibleActions : gridActions).map((a) => {
          const isHidden = hidden.has(a.key);
          return (
            <div
              key={a.key}
              className="wlt-action-cell"
              onClick={() => (editMode ? toggleHidden(a.key) : navigate(a.path))}
              style={{
                position: "relative",
                background: "#fff",
                border: "1px solid #f0f1f3",
                borderRadius: 12,
                padding: "12px 4px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 7,
                cursor: "pointer",
                minHeight: 76,
                opacity: editMode && isHidden ? 0.35 : 1,
              }}
            >
              {editMode && (
                <span
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: isHidden ? "#c9cdd4" : "#f5222d",
                    color: "#fff",
                    fontSize: 11,
                    lineHeight: "18px",
                    textAlign: "center",
                  }}
                >
                  {isHidden ? "+" : "−"}
                </span>
              )}
              <span style={{ color: "#1668dc" }}>{a.icon}</span>
              <span style={{ fontSize: 11.5, color: "#1f2329", fontWeight: 500 }}>{a.title}</span>
              <span style={{ fontSize: 9.5, color: "#c9cdd4" }}>{a.sub}</span>
            </div>
          );
        })}
      </div>

      {/* 我的申请状态 */}
      <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: "1px solid #f5f6f8", fontSize: 13.5, fontWeight: 600 }}>
          <span>我的申请</span>
          <span style={{ fontSize: 11.5, color: "#1668dc", fontWeight: 400, cursor: "pointer" }} onClick={() => navigate("/requisitions/list")}>全部 ›</span>
        </div>
        {reqs.length === 0 && <div style={{ padding: "20px 14px", color: "#c9cdd4", fontSize: 12.5, textAlign: "center" }}>暂无申请记录，点右上角「领用申请」开单</div>}
        {reqs.map((r) => (
          <div key={r.id} onClick={() => navigate(`/requisitions/${r.id}`)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #f5f6f8", cursor: "pointer" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "#1f2329", display: "flex", alignItems: "center", gap: 6 }}>
                {r.bill_no}
                <Tag color={STATUS[r.status]?.color} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, lineHeight: 1.4 }}>{STATUS[r.status]?.text ?? r.status}</Tag>
              </div>
              <div style={{ fontSize: 11.5, color: "#646a73", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.use_location} · {r.use_reason} · {r.created_at.slice(0, 16)}
              </div>
            </div>
            <span style={{ color: "#c9cdd4" }}>›</span>
          </div>
        ))}
      </div>

      {/* 通知摘要 */}
      <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: "1px solid #f5f6f8", fontSize: 13.5, fontWeight: 600 }}>
          <span>通知</span>
          <span style={{ fontSize: 11.5, color: "#1668dc", fontWeight: 400, cursor: "pointer" }} onClick={() => navigate("/notifications")}>全部 ›</span>
        </div>
        <div style={{ padding: "14px 14px", color: "#646a73", fontSize: 12.5, lineHeight: 1.7 }}>
          {unread > 0 ? <>有 <b style={{ color: "#1668dc" }}>{unread}</b> 条未读通知：领用审计结果、库存预警、OCR 完成提醒均在此查看。</> : "暂无未读通知，预警与审批结果将在此提醒。"}
        </div>
      </div>
    </div>
  );
}
