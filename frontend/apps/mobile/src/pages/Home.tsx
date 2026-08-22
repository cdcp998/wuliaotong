import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Badge, Tag } from "antd-mobile";

import { notificationApi, requisitionApi, useAuthStore, type RequisitionBill } from "@wlt/shared";

import { FUNCTIONS, loadHomeHidden, loadHomeOrder, mergeOrder, reorderVisible, saveHomeHidden, saveHomeOrder, sortByOrder } from "../functions";
import { ReorderGrid } from "../components/ReorderGrid";

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待完成工作", color: "warning" },
  2: { text: "待审计", color: "primary" },
  3: { text: "已完成", color: "success" },
  4: { text: "已驳回", color: "danger" },
  5: { text: "已取消", color: "default" },
};

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
  const [order, setOrder] = useState<string[]>([]); // 共享显示顺序（首页快捷操作与功能页）

  const isSuper = user?.role?.code === "super_admin";
  const visibleActions = FUNCTIONS.filter((a) => !a.perm || hasPerm(a.perm) || isSuper);
  const orderedActions = sortByOrder(visibleActions, order);
  const gridActions = orderedActions.filter((a) => !hidden.has(a.key));

  // 每用户的本机宫格偏好（隐藏集 + 显示顺序，均不随权限变化丢失）
  useEffect(() => {
    if (!user) return;
    setHidden(loadHomeHidden(user.id));
    setOrder(mergeOrder(loadHomeOrder(user.id), FUNCTIONS.map((f) => f.key)));
  }, [user?.id]);

  function toggleHidden(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      if (user) saveHomeHidden(user.id, next);
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
        className="wlt-hero"
        style={{
          background: "#5B7FFF",
          borderRadius: 16,
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
      <div className="wlt-home-section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1E2433" }}>快捷操作</span>
        <span
          style={{ fontSize: 12, color: editMode ? "#5B7FFF" : "#5B6478", cursor: "pointer", padding: "4px 2px" }}
          onClick={() => setEditMode((v) => !v)}
        >
          {editMode ? "完成" : "编辑"}
        </span>
      </div>
      {editMode ? (
        /* 编辑模式：卡片宫格直接拖拽排序、− 隐藏 / + 恢复 */
        <ReorderGrid
          items={orderedActions}
          cols={4}
          gap={10}
          onChange={(next) => {
            setOrder((prev) => reorderVisible(prev, orderedActions.map((x) => x.key), next.map((x) => x.key)));
          }}
          onDrop={(next) => {
            if (!user) return;
            setOrder((prev) => {
              const n = reorderVisible(prev, orderedActions.map((x) => x.key), next.map((x) => x.key));
              saveHomeOrder(user.id, n);
              return n;
            });
          }}
          renderContent={(a) => {
            const isHidden = hidden.has(a.key);
            return (
              <div
                style={{
                  position: "relative",
                  background: "#fff",
                  border: "1px solid #E4EAF6",
                  borderRadius: 16,
                  padding: "12px 4px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 7,
                  minHeight: 76,
                  cursor: "grab",
                  opacity: isHidden ? 0.45 : 1,
                }}
              >
                <span
                  data-nodrag
                  onClick={() => toggleHidden(a.key)}
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: isHidden ? "#22C55E" : "#EF4444",
                    color: "#fff",
                    fontSize: 12,
                    lineHeight: "18px",
                    textAlign: "center",
                    cursor: "pointer",
                    zIndex: 2,
                  }}
                >
                  {isHidden ? "+" : "−"}
                </span>
                <span style={{ color: "#5B7FFF" }}>{a.icon}</span>
                <span style={{ fontSize: 11.5, color: "#1E2433", fontWeight: 500 }}>{a.title}</span>
                <span style={{ fontSize: 9.5, color: "#c9cdd4" }}>{isHidden ? "已隐藏" : a.sub}</span>
              </div>
            );
          }}
          footer={
            <div style={{ fontSize: 11, color: "#c9cdd4", lineHeight: 1.7, padding: "8px 4px 2px" }}>
              按住卡片拖动调整功能顺序（与「功能」页同步）；点 − 从首页快捷操作隐藏，点 + 恢复。
            </div>
          }
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 10, marginBottom: 12 }}>
          {gridActions.map((a) => (
            <div
              key={a.key}
              className="wlt-action-cell"
              onClick={() => navigate(a.path)}
              style={{
                position: "relative",
                background: "#fff",
                border: "1px solid #E4EAF6",
                borderRadius: 16,
                padding: "12px 4px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 7,
                cursor: "pointer",
                minHeight: 76,
              }}
            >
              <span style={{ color: "#5B7FFF" }}>{a.icon}</span>
              <span style={{ fontSize: 11.5, color: "#1E2433", fontWeight: 500 }}>{a.title}</span>
              <span style={{ fontSize: 9.5, color: "#c9cdd4" }}>{a.sub}</span>
            </div>
          ))}
        </div>
      )}

      {/* 我的申请状态 */}
      <div className="wlt-section" style={{ background: "#fff", border: "1px solid #E4EAF6", borderRadius: 16, overflow: "hidden", marginBottom: 12, boxShadow: "0 6px 20px rgba(30,36,51,.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: "1px solid #F2F5FB", fontSize: 13.5, fontWeight: 600 }}>
          <span>我的申请</span>
          <span style={{ fontSize: 11.5, color: "#5B7FFF", fontWeight: 400, cursor: "pointer" }} onClick={() => navigate("/requisitions/list")}>全部 ›</span>
        </div>
        {reqs.length === 0 && <div style={{ padding: "20px 14px", color: "#c9cdd4", fontSize: 12.5, textAlign: "center" }}>暂无申请记录，点右上角「领用申请」开单</div>}
        {reqs.map((r) => (
          <div key={r.id} onClick={() => navigate(`/requisitions/${r.id}`)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #F2F5FB", cursor: "pointer" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "#1E2433", display: "flex", alignItems: "center", gap: 6 }}>
                {r.bill_no}
                <Tag color={STATUS[r.status]?.color} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, lineHeight: 1.4 }}>{STATUS[r.status]?.text ?? r.status}</Tag>
              </div>
              <div style={{ fontSize: 11.5, color: "#5B6478", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.use_location} · {r.use_reason} · {r.created_at.slice(0, 16)}
              </div>
            </div>
            <span style={{ color: "#c9cdd4" }}>›</span>
          </div>
        ))}
      </div>

      {/* 通知摘要 */}
      <div className="wlt-section" style={{ background: "#fff", border: "1px solid #E4EAF6", borderRadius: 16, overflow: "hidden", boxShadow: "0 6px 20px rgba(30,36,51,.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: "1px solid #F2F5FB", fontSize: 13.5, fontWeight: 600 }}>
          <span>通知</span>
          <span style={{ fontSize: 11.5, color: "#5B7FFF", fontWeight: 400, cursor: "pointer" }} onClick={() => navigate("/notifications")}>全部 ›</span>
        </div>
        <div style={{ padding: "14px 14px", color: "#5B6478", fontSize: 12.5, lineHeight: 1.7 }}>
          {unread > 0 ? <>有 <b style={{ color: "#5B7FFF" }}>{unread}</b> 条未读通知：领用审计结果、库存预警、OCR 完成提醒均在此查看。</> : "暂无未读通知，预警与审批结果将在此提醒。"}
        </div>
      </div>
    </div>
  );
}
