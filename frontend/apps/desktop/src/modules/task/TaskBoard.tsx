/** task 模块：任务看板（/task/board，task:dispatch）——按状态分列 + 派发/流转快捷操作。
 *  v2 界面：玻璃看板列 + 优先级/维修人卡片 + 看板⇄列表切换（与设计稿一致）。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Descriptions, Drawer, Input, Popconfirm, Select, Space, Tag, theme } from "antd";
import { UnorderedListOutlined, PlusOutlined, FlagOutlined } from "@ant-design/icons";

import { adminApi } from "@wlt/shared";

import { taskApi, type TaskItem } from "./api";

const COLUMNS = ["pending", "assigned", "in_progress", "done", "verified", "closed", "cancelled"];

const ST: Record<string, { label: string; fg: string; bg: string; dot: string }> = {
  pending: { label: "待派发", fg: "#B45309", bg: "#FEF4E2", dot: "#F59E0B" },
  assigned: { label: "已派发", fg: "#3B5BDB", bg: "#EAEFFF", dot: "#5B7FFF" },
  in_progress: { label: "进行中", fg: "#0E7490", bg: "#E0F2FE", dot: "#0891B2" },
  done: { label: "完成待验", fg: "#7C3AED", bg: "#F3E8FF", dot: "#8B5CF6" },
  verified: { label: "已验证", fg: "#15803D", bg: "#E8F9EF", dot: "#22C55E" },
  closed: { label: "已关闭", fg: "#64748B", bg: "#EFF3FC", dot: "#94A3B8" },
  cancelled: { label: "已取消", fg: "#DC2626", bg: "#FDEBEC", dot: "#EF4444" },
};

export function TaskBoardPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [workers, setWorkers] = useState<{ id: number; name: string }[]>([]);
  const [current, setCurrent] = useState<TaskItem | null>(null);
  const [assignee, setAssignee] = useState<number | undefined>();
  const [verdict, setVerdict] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await taskApi.list({ page_size: 200 });
      setTasks(r.items);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    adminApi.users({ role_id: 6, status: 1, page_size: 200 })
      .then((r) => setWorkers(r.list.map((u) => ({ id: u.id, name: u.real_name || u.username }))))
      .catch(() => undefined);
  }, []);

  const act = async (t: TaskItem, action: string, extra?: object) => {
    try {
      await taskApi.status(t.id, { action, ...extra });
      message.success("已更新");
      setCurrent(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const byStatus = useMemo(() => {
    const m: Record<string, TaskItem[]> = {};
    for (const c of COLUMNS) m[c] = [];
    for (const t of tasks) (m[t.status] ??= []).push(t);
    return m;
  }, [tasks]);

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 44） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>维修任务看板</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            7 状态列拖拽流转；卡片：优先/单号/负责人/时间；看板 ⇄ 列表视图切换
          </p>
        </div>
        <Space>
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<UnorderedListOutlined style={{ color: "#5B7FFF" }} />} onClick={() => navigate("/task/list")}>切换列表视图</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/task/list")}>新建任务</Button>
        </Space>
      </div>

      {/* 看板 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(140px, 1fr))", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
        {COLUMNS.map((status) => {
          const meta = ST[status] ?? { label: status, fg: "#64748B", bg: "#EFF3FC", dot: "#94A3B8" };
          const items = byStatus[status] ?? [];
          return (
            <div key={status} style={{ background: "#FFFFFF", border: `1px solid #E4EAF6`, borderRadius: 14, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: meta.dot }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{meta.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#8A93A8" }}>{items.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {loading && items.length === 0 && <div style={{ color: token.colorTextTertiary, fontSize: 12, textAlign: "center", padding: 12 }}>加载中…</div>}
                {!loading && items.length === 0 && <div style={{ color: token.colorTextTertiary, fontSize: 11.5, textAlign: "center", padding: 12, border: "1px dashed #CBD6EC", borderRadius: 10 }}>暂无任务</div>}
                {items.map((t) => (
                  <div key={t.id} onClick={() => { setCurrent(t); setAssignee(undefined); setVerdict(""); }}
                    style={{ cursor: "pointer", background: "#F6F8FE", border: `1px solid ${t.priority === 2 ? "#FCA5A5" : "#E4EAF6"}`, borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {t.priority === 2
                        ? <span style={{ fontSize: 10.5, fontWeight: 600, color: "#EF4444" }}>紧急</span>
                        : t.priority === 1
                          ? <span style={{ fontSize: 10.5, fontWeight: 600, color: "#F59E0B" }}>高优</span>
                          : <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8A93A8" }}>普通</span>}
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: "#1E2433", flex: 1 }}>{t.title}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: "#8A93A8" }}>{t.description || `${t.task_no} · 待派发`}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#5B6478" }}>
                      <span style={{ flex: 1 }}>{t.assignee_name ? `${t.assignee_name} · ${t.scheduled_time ? t.scheduled_time.slice(5, 16) : ""}` : `${t.task_no} · ${t.scheduled_time ? t.scheduled_time.slice(5, 16) : ""}`}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 22 }}>
                      <Tag style={{ borderRadius: 999, background: meta.bg, color: meta.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{meta.label}</Tag>
                      {status === "pending" && <Button size="small" type="primary" icon={<FlagOutlined />} onClick={(e) => { e.stopPropagation(); setCurrent(t); }}>派发</Button>}
                      {status === "done" && (
                        <>
                          <Button size="small" onClick={(e) => { e.stopPropagation(); setCurrent(t); setVerdict(""); }}>验收</Button>
                          <Popconfirm title="驳回该任务？" onConfirm={() => act(t, "reject", { verdict: "驳回重做" })}>
                            <Button size="small" danger onClick={(e) => e.stopPropagation()}>驳回</Button>
                          </Popconfirm>
                        </>
                      )}
                      {status === "verified" && (
                        <Popconfirm title="关闭该任务？" onConfirm={() => act(t, "close")}>
                          <Button size="small" onClick={(e) => e.stopPropagation()}>关闭</Button>
                        </Popconfirm>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 派发/验收抽屉 */}
      <Drawer open={!!current} onClose={() => setCurrent(null)} width={520} title={current ? `任务 ${current.task_no}` : ""}>
        {current && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 4 }}>
              <Descriptions.Item label="状态">
                <Tag style={{ borderRadius: 999, background: ST[current.status]?.bg, color: ST[current.status]?.fg, borderColor: "transparent" }}>{ST[current.status]?.label ?? current.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="标题">{current.title}</Descriptions.Item>
              <Descriptions.Item label="描述">{current.description || "—"}</Descriptions.Item>
              <Descriptions.Item label="维修人员">{current.assignee_name || "未派发"}</Descriptions.Item>
              {current.verdict && <Descriptions.Item label="结论">{current.verdict}</Descriptions.Item>}
              {current.cancel_reason && <Descriptions.Item label="取消原因">{current.cancel_reason}</Descriptions.Item>}
            </Descriptions>
            {current.status === "pending" && (
              <Space>
                <Select placeholder="选择维修人员" style={{ width: 240 }} value={assignee} onChange={setAssignee} options={workers.map((w) => ({ value: w.id, label: w.name }))} />
                <Button type="primary" disabled={!assignee} onClick={() => act(current, "assign", { assignee_id: assignee })}>确认派发</Button>
              </Space>
            )}
            {current.status === "done" && (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Input value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="验收结论（必填）" />
                <Button type="primary" disabled={!verdict.trim()} onClick={() => act(current, "verify", { verdict })}>验收通过</Button>
              </Space>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
