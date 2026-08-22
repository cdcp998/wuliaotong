import { useEffect, useState } from "react";
import { NavBar } from "antd-mobile";
import { useNavigate } from "react-router";

import { useAuthStore } from "@wlt/shared";

import { FUNCTIONS, loadHomeHidden, loadHomeOrder, mergeOrder, reorderVisible, saveHomeHidden, saveHomeOrder, sortByOrder } from "../functions";
import { ReorderGrid } from "../components/ReorderGrid";

/** 功能页（手机端 TabBar 第 2 项）：展示手机端全部功能卡片；
 * 点卡片进入对应功能；点 ★ 加入/移出首页「快捷操作」；点「编辑」可 ▲▼ 调整功能顺序（与首页共享顺序）。 */
export function FunctionsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]);
  const [editMode, setEditMode] = useState(false);

  const isSuper = user?.role?.code === "super_admin";
  const visible = FUNCTIONS.filter((a) => !a.perm || hasPerm(a.perm) || isSuper);
  const ordered = sortByOrder(visible, order);

  // 每用户的本机快捷操作偏好（隐藏集 + 共享显示顺序）
  useEffect(() => {
    if (!user) return;
    setHidden(loadHomeHidden(user.id));
    setOrder(mergeOrder(loadHomeOrder(user.id), FUNCTIONS.map((f) => f.key)));
  }, [user?.id]);

  function togglePin(key: string) {
    if (!user) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveHomeHidden(user.id, next);
      return next;
    });
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar
        onBack={() => navigate("/")}
        right={
          <span style={{ fontSize: 12, color: editMode ? "#EF4444" : "#5B7FFF" }} onClick={() => setEditMode((v) => !v)}>
            {editMode ? "完成" : "编辑"}
          </span>
        }
      >
        功能
      </NavBar>
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 12, color: "#5B6478", lineHeight: 1.7, padding: "2px 4px 10px" }}>
          {editMode ? (
            "按住卡片拖动调整功能顺序（与首页「快捷操作」同步）。"
          ) : (
            <>
              全部功能（{visible.length} 项）——点卡片进入；点右上角
              <span style={{ color: "#F59E0B", fontWeight: 600, margin: "0 2px" }}>★</span>
              可加入 / 移出首页「快捷操作」。
            </>
          )}
        </div>

        {editMode ? (
          /* 编辑模式：卡片宫格直接拖拽排序（★ 变灰 = 已移出首页快捷操作） */
          <ReorderGrid
            items={ordered}
            cols={4}
            gap={10}
            onChange={(next) => {
              setOrder((prev) => reorderVisible(prev, ordered.map((x) => x.key), next.map((x) => x.key)));
            }}
            onDrop={(next) => {
              if (!user) return;
              setOrder((prev) => {
                const n = reorderVisible(prev, ordered.map((x) => x.key), next.map((x) => x.key));
                saveHomeOrder(user.id, n);
                return n;
              });
            }}
            renderContent={(a) => {
              const pinned = !hidden.has(a.key);
              return (
                <div
                  style={{
                    position: "relative",
                    background: "#fff",
                    border: "1px solid #E4EAF6",
                    borderRadius: 14,
                    padding: "12px 4px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 7,
                    minHeight: 76,
                    cursor: "grab",
                    opacity: pinned ? 1 : 0.55,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 5,
                      right: 7,
                      fontSize: 13,
                      lineHeight: 1,
                      color: pinned ? "#F59E0B" : "#c9cdd4",
                    }}
                    title={pinned ? "已在首页快捷操作" : "未加入首页快捷操作"}
                  >
                    {pinned ? "★" : "☆"}
                  </span>
                  <span style={{ color: "#5B7FFF" }}>{a.icon}</span>
                  <span style={{ fontSize: 11.5, color: "#1E2433", fontWeight: 500 }}>{a.title}</span>
                  <span style={{ fontSize: 9.5, color: "#c9cdd4" }}>{a.sub}</span>
                </div>
              );
            }}
            footer={
              <div style={{ fontSize: 11, color: "#c9cdd4", lineHeight: 1.7, padding: "8px 4px 2px" }}>
                按住卡片拖动调整功能顺序（与首页「快捷操作」同步）；普通模式点 ★ 可加入/移出首页。
              </div>
            }
          />
        ) : (
          /* 普通模式：宫格卡片 + ★ 加入/移出首页 */
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 10 }}>
            {ordered.map((a) => {
              const pinned = !hidden.has(a.key);
              return (
                <div
                  key={a.key}
                  className="wlt-action-cell"
                  onClick={() => navigate(a.path)}
                  style={{
                    position: "relative",
                    background: "#fff",
                    border: "1px solid #E4EAF6",
                    borderRadius: 14,
                    padding: "12px 4px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 7,
                    cursor: "pointer",
                    minHeight: 76,
                  }}
                >
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(a.key);
                    }}
                    title={pinned ? "已在首页快捷操作（点击移出）" : "加入首页快捷操作"}
                    style={{
                      position: "absolute",
                      top: 5,
                      right: 7,
                      fontSize: 15,
                      lineHeight: 1,
                      cursor: "pointer",
                      color: pinned ? "#F59E0B" : "#c9cdd4",
                      padding: 2,
                    }}
                  >
                    {pinned ? "★" : "☆"}
                  </span>
                  <span style={{ color: "#5B7FFF" }}>{a.icon}</span>
                  <span style={{ fontSize: 11.5, color: "#1E2433", fontWeight: 500 }}>{a.title}</span>
                  <span style={{ fontSize: 9.5, color: "#c9cdd4" }}>{a.sub}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
