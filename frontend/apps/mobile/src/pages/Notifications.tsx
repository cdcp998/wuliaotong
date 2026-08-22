import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Dialog, List, NavBar, SpinLoading, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { notificationApi, type NotificationItem } from "@wlt/shared";

const BIZ_STYLE: Record<string, { text: string; color: "danger" | "warning" | "primary" | "success" }> = {
  "预警": { text: "预警", color: "danger" },
  "待办": { text: "待办", color: "warning" },
  "审批": { text: "审批", color: "primary" },
};

/** 移动端可跳转的通知链接前缀（其余如删除审核在电脑端处理，仅标记已读不跳转）。 */
const MOBILE_LINK_PREFIXES = ["/requisitions/", "/stock/query"];

/** 通知列表（手机端 TabBar 第 4 项）：预警/待办/审批；点击业务通知跳转对应单据并自动已读。
 * 管理模式下支持全选 + 一键删除选中、清空全部（《UI设计方案.md》§5.8）。 */
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
    <div style={{ minHeight: "100dvh", background: "#F2F5FB", paddingBottom: manage ? 64 : 0 }}>
      <NavBar
        onBack={() => navigate("/")}
        right={
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {!manage && (
              marking ? (
                <SpinLoading style={{ "--size": "18px" } as React.CSSProperties} />
              ) : (
                <span style={{ fontSize: 12, color: "#5B7FFF" }} onClick={() => void markAllRead()}>
                  全部已读
                </span>
              )
            )}
            <span style={{ fontSize: 12, color: manage ? "#EF4444" : "#5B7FFF" }} onClick={toggleManage}>
              {manage ? "完成" : "管理"}
            </span>
          </span>
        }
      >
        通知
      </NavBar>

      {manage && (
        <div
          style={{
            padding: "8px 12px",
            background: "#fff",
            borderBottom: "1px solid #f0f1f3",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={toggleAll}>
            <Checkbox checked={allSelected} style={{ "--icon-size": "18px" } as React.CSSProperties} />
            <span style={{ fontSize: 13, color: "#1E2433" }}>全选</span>
          </div>
          <span style={{ fontSize: 12, color: "#5B6478", display: "flex", alignItems: "center" }}>
            已选 {selected.size} 条
            <span style={{ color: "#5B7FFF", marginLeft: 12 }} onClick={() => void clearAll()}>
              清空全部
            </span>
          </span>
        </div>
      )}

      <List style={{ "--border-top": "0" } as React.CSSProperties}>
        {list.map((n) => {
          const style = BIZ_STYLE[n.biz_type] ?? { text: n.biz_type, color: "default" as const };
          const checked = selected.has(n.id);
          return (
            <List.Item
              key={n.id}
              onClick={() => void onItemClick(n)}
              prefix={
                manage ? (
                  <Checkbox checked={checked} style={{ "--icon-size": "20px" } as React.CSSProperties} />
                ) : (
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      background: n.is_read ? "#f2f3f5" : "#EAEFFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5B7FFF" }} />}
                  </span>
                )
              }
              description={
                <div>
                  <div style={{ fontSize: 12.5, color: "#4e5969", lineHeight: 1.6, marginTop: 2 }}>{n.content}</div>
                  <div style={{ fontSize: 10.5, color: "#c9cdd4", marginTop: 5 }}>{n.created_at.slice(0, 16)}</div>
                </div>
              }
              extra={<Tag color={style.color}>{style.text}</Tag>}
              style={manage && checked ? { background: "#f0f6ff" } : undefined}
            >
              <span style={{ fontWeight: n.is_read ? 400 : 600, fontSize: 13.5 }}>{n.title}</span>
            </List.Item>
          );
        })}
        {loading && (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
            <SpinLoading />
          </div>
        )}
        {!loading && list.length === 0 && <List.Item>暂无通知</List.Item>}
      </List>

      {/* 管理模式底部操作栏：一键删除选中（宽屏「应用窗口化」时居中限宽，避免横向超出界面） */}
      {manage && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: 0,
            width: "100%",
            maxWidth: 720,
            boxSizing: "border-box",
            padding: "10px 12px",
            paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
            background: "#fff",
            borderTop: "1px solid #f0f1f3",
            display: "flex",
            alignItems: "center",
            gap: 10,
            zIndex: 20,
          }}
        >
          <div style={{ flex: 1, fontSize: 13, color: "#5B6478", textAlign: "right", marginRight: 10 }}>
            共 <b style={{ color: "#1E2433", fontSize: 15, margin: "0 2px" }}>{list.length}</b> 条
          </div>
          <Button block color="danger" loading={deleting} disabled={selected.size === 0} style={{ height: 40, fontSize: 14, borderRadius: 10, flex: 2 }} onClick={() => void deleteSelected()}>
            删除选中（{selected.size}）
          </Button>
        </div>
      )}
    </div>
  );
}
