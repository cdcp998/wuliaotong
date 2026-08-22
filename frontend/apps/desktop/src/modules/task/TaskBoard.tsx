/** task 模块：任务看板（/task/board，task:dispatch）——按状态分列 + 派发/流转快捷操作。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Col, Descriptions, Drawer, Input, Popconfirm, Row, Select, Space, Tag, Typography } from "antd";

import { adminApi } from "@wlt/shared";

import { STATUS_LABEL, taskApi, type TaskItem } from "./api";

const COLUMNS = ["pending", "assigned", "in_progress", "done", "verified", "closed", "cancelled"];

export function TaskBoardPage() {
  const { message } = App.useApp();
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
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>维修任务看板</Typography.Title>
      <Row gutter={12}>
        {COLUMNS.map((status) => (
          <Col key={status} span={Math.floor(24 / COLUMNS.length)}>
            <Card size="small" title={<Space><Tag color={STATUS_LABEL[status]?.color}>{STATUS_LABEL[status]?.label ?? status}</Tag>{byStatus[status]?.length ?? 0}</Space>} loading={loading}>
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                {(byStatus[status] ?? []).map((t) => (
                  <Card key={t.id} size="small" hoverable onClick={() => { setCurrent(t); setAssignee(undefined); setVerdict(""); }}>
                    <Typography.Text strong>{t.title}</Typography.Text>
                    <div style={{ fontSize: 12, color: "#888" }}>
                      {t.task_no}　{t.assignee_name ? `→ ${t.assignee_name}` : "未派发"}
                      {t.priority === 2 && <Tag color="red" style={{ marginLeft: 6 }}>紧急</Tag>}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      {status === "pending" && <Button size="small" type="primary" onClick={(e) => { e.stopPropagation(); setCurrent(t); }}>派发</Button>}
                      {status === "done" && (
                        <Space size={4}>
                          <Button size="small" onClick={(e) => { e.stopPropagation(); setCurrent(t); setVerdict(""); }}>验收</Button>
                          <Popconfirm title="驳回该任务？" onConfirm={() => act(t, "reject", { verdict: "驳回重做" })}>
                            <Button size="small" danger onClick={(e) => e.stopPropagation()}>驳回</Button>
                          </Popconfirm>
                        </Space>
                      )}
                      {status === "verified" && (
                        <Popconfirm title="关闭该任务？" onConfirm={() => act(t, "close")}>
                          <Button size="small" onClick={(e) => e.stopPropagation()}>关闭</Button>
                        </Popconfirm>
                      )}
                    </div>
                  </Card>
                ))}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Drawer open={!!current} onClose={() => setCurrent(null)} width={520} title={current ? `任务 ${current.task_no}` : ""}>
        {current && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_LABEL[current.status]?.color}>{STATUS_LABEL[current.status]?.label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="标题">{current.title}</Descriptions.Item>
              <Descriptions.Item label="描述">{current.description || "—"}</Descriptions.Item>
              <Descriptions.Item label="维修人员">{current.assignee_name || "未派发"}</Descriptions.Item>
              {current.verdict && <Descriptions.Item label="结论">{current.verdict}</Descriptions.Item>}
              {current.cancel_reason && <Descriptions.Item label="取消原因">{current.cancel_reason}</Descriptions.Item>}
            </Descriptions>
            {current.status === "pending" && (
              <Space>
                <Select placeholder="选择维修人员" style={{ width: 220 }} value={assignee} onChange={setAssignee}
                  options={workers.map((w) => ({ value: w.id, label: w.name }))} />
                <Button type="primary" disabled={!assignee} onClick={() => act(current, "assign", { assignee_id: assignee })}>确认派发</Button>
              </Space>
            )}
            {current.status === "done" && (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Input value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="验收结论（必填）" />
                <Button type="primary" disabled={!verdict.trim()} onClick={() => act(current, "verify", { verdict })}>验收通过</Button>
              </Space>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
