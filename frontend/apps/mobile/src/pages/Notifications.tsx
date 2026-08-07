import { useCallback, useEffect, useState } from "react";
import { List, NavBar, SpinLoading, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { notificationApi, type NotificationItem } from "@wlt/shared";

const BIZ_STYLE: Record<string, { text: string; color: "danger" | "warning" | "primary" | "success" }> = {
  "预警": { text: "预警", color: "danger" },
  "待办": { text: "待办", color: "warning" },
  "审批": { text: "审批", color: "primary" },
};

/** 通知列表（手机端 TabBar 第 4 项）：预警/审计结果/OCR 完成（《UI设计方案.md》§5.8）。 */
export function NotificationsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false); // 全部已读进行中（防重复点击 + 反馈）

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

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar
        onBack={() => navigate("/")}
        right={
          marking ? (
            <SpinLoading style={{ "--size": "18px" } as React.CSSProperties} />
          ) : (
            <span style={{ fontSize: 12, color: "#1668dc" }} onClick={() => void markAllRead()}>
              全部已读
            </span>
          )
        }
      >
        通知
      </NavBar>
      <List style={{ "--border-top": "0" } as React.CSSProperties}>
        {list.map((n) => {
          const style = BIZ_STYLE[n.biz_type] ?? { text: n.biz_type, color: "default" as const };
          return (
            <List.Item
              key={n.id}
              prefix={
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: n.is_read ? "#f2f3f5" : "#e8f1fd",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1668dc" }} />}
                </span>
              }
              description={
                <div>
                  <div style={{ fontSize: 12.5, color: "#4e5969", lineHeight: 1.6, marginTop: 2 }}>{n.content}</div>
                  <div style={{ fontSize: 10.5, color: "#c9cdd4", marginTop: 5 }}>{n.created_at.slice(0, 16)}</div>
                </div>
              }
              extra={<Tag color={style.color}>{style.text}</Tag>}
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
    </div>
  );
}
