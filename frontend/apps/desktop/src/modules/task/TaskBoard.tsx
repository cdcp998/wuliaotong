/** task 模块：维修任务看板（/task/board，task:dispatch）——按状态分列 + 派发/流转快捷操作。
 *  v4 统一任务池：合并显示「线缆维修任务 + 设备维修任务」（后端 /tasks/pool 联动视图），
 *  卡片携带关联信息（故障摘要/设备摘要），可直接查看、跳转对应模块；
 *  支持 ?focus_task=c12|d3 跨页定位（故障管理/列表跳转入口）。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { App, Button, Descriptions, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Tag, theme } from "antd";
import { UnorderedListOutlined, PlusOutlined, FlagOutlined, LinkOutlined } from "@ant-design/icons";

import { adminApi, useAuthStore } from "@wlt/shared";

import { cableApi, FAULT_STATUS } from "../cable/api";
import { DEVICE_STATUS, deviceApi } from "../device/api";
import { taskApi, type PoolItem } from "./api";

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

/** 来源徽标：线缆任务 / 设备任务。 */
function SourceBadge({ source }: { source: PoolItem["source"] }) {
  return source === "device" ? (
    <span style={{ fontSize: 10, fontWeight: 700, color: "#3B5BDB", background: "#EAEFFF", borderRadius: 999, padding: "1px 8px" }}>设备</span>
  ) : (
    <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", background: "#FEF4E2", borderRadius: 999, padding: "1px 8px" }}>线缆</span>
  );
}

export function TaskBoardPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // cable/device 模块未启用时隐藏关联入口（任务池自动降级为纯线缆/独立视图）
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const cableEnabled = moduleEnabled("cable");
  const deviceEnabled = moduleEnabled("device");
  const [tasks, setTasks] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"" | "cable" | "device">("");
  const [workers, setWorkers] = useState<{ id: number; name: string }[]>([]);
  const [current, setCurrent] = useState<PoolItem | null>(null);
  const [assignee, setAssignee] = useState<number | undefined>();
  const [verdict, setVerdict] = useState("");
  // 新建任务弹窗（看板页直接创建，不再跳转列表页）
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [faults, setFaults] = useState<{ id: number; label: string }[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 统一任务池：线缆 + 设备任务合并（page_size 上限为后端 le=100）
      const r = await taskApi.pool({ page_size: 100, source });
      setTasks(r.items);
    } finally {
      setLoading(false);
    }
  }, [source]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    adminApi.users({ role_id: 6, status: 1, page_size: 100 })
      .then((r) => setWorkers(r.list.map((u) => ({ id: u.id, name: u.real_name || u.username }))))
      .catch(() => undefined);
    if (cableEnabled) {
      cableApi.listFaults({ page_size: 100 }).then((r) => {
        setFaults(r.items.map((f) => ({ id: f.id, label: `#${f.id} ${f.fault_type || "故障"}（${FAULT_STATUS[f.status]?.label ?? f.status}）` })));
      }).catch(() => undefined);
    }
  }, [cableEnabled]);

  /** 跨页定位：?focus_task=c12|d3 → 自动打开对应任务抽屉（故障管理/列表跳转入口）。 */
  useEffect(() => {
    const key = searchParams.get("focus_task");
    if (!key || loading || tasks.length === 0) return;
    const t = tasks.find((x) => x.key === key);
    if (t) {
      setCurrent(t);
      setVerdict("");
      setAssignee(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, loading]);

  /** 看板页直接新建任务（线缆维修任务；与列表页同字段）。 */
  const createTask = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await taskApi.create({ title: v.title, description: v.description ?? "", priority: v.priority ?? 1, fault_id: v.fault_id ?? null });
      message.success("任务已创建");
      setOpen(false);
      form.resetFields();
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    form.resetFields();
    setOpen(true);
  };

  /** 统一状态流转：按来源路由到对应模块接口（线缆 /tasks/{id}/status，设备 /device-tasks/{id}/status）。 */
  const act = async (t: PoolItem, action: string, extra?: object) => {
    try {
      const r = t.source === "device"
        ? await deviceApi.taskStatus(t.id, { action, ...extra })
        : await taskApi.status(t.id, { action, ...extra });
      message.success("已更新");
      // 回退文本提示词（设备任务验收/取消自动回退快照状态时生成）
      const prompt = (r as { rollback_prompt?: string }).rollback_prompt;
      if (prompt) message.info(prompt, 5);
      setCurrent(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  /** 统一派发：按来源路由到对应模块接口。 */
  const doAssign = async (t: PoolItem, assigneeId?: number) => {
    if (!assigneeId) return;
    try {
      if (t.source === "device") await deviceApi.assignTask(t.id, assigneeId);
      else await taskApi.assign(t.id, assigneeId);
      message.success("已派发");
      setCurrent(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "派发失败");
    }
  };

  const byStatus = useMemo(() => {
    const m: Record<string, PoolItem[]> = {};
    for (const c of COLUMNS) m[c] = [];
    for (const t of tasks) (m[t.status] ??= []).push(t);
    return m;
  }, [tasks]);

  /** 关联信息区（抽屉内）：故障摘要 / 设备摘要 + 跳转按钮。 */
  const renderLinkInfo = (t: PoolItem) => (
    <div style={{ border: `1px solid ${token.colorBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary }}><LinkOutlined /> 关联信息</div>
      {t.source === "cable" && (t.fault_id || t.cable_name) ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
          {t.fault_id ? <>故障 #{t.fault_id}{t.fault_type ? ` · ${t.fault_type}` : ""}{t.fault_status != null && <Tag style={{ borderRadius: 999, marginInlineEnd: 0, background: FAULT_STATUS[t.fault_status]?.bg, color: FAULT_STATUS[t.fault_status]?.fg, borderColor: "transparent" }}>{FAULT_STATUS[t.fault_status]?.label}</Tag>}</> : null}
          {t.cable_name ? <span style={{ color: token.colorTextSecondary }}>线缆：{t.cable_name}</span> : null}
          {cableEnabled && t.fault_id && (
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate(`/cable/faults?focus=${t.fault_id}`)}>查看故障 ›</Button>
          )}
        </div>
      ) : null}
      {t.source === "device" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
          <span>设备：{t.device_name || "—"}{t.device_code ? `（${t.device_code}）` : ""}</span>
          {t.device_status != null && <Tag style={{ borderRadius: 999, marginInlineEnd: 0 }}>{DEVICE_STATUS[t.device_status]?.label ?? t.device_status}</Tag>}
          <span style={{ color: token.colorTextTertiary }}>快照回退目标：{t.previous_status ? DEVICE_STATUS[t.previous_status]?.label ?? "-" : "-"}</span>
          {deviceEnabled && (
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate(`/device/tasks?focus=d${t.id}`)}>查看设备维修任务 ›</Button>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>维修任务看板</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            统一任务池{deviceEnabled ? "（线缆 + 设备合并显示）" : ""}：7 状态列卡片流转；点击卡片查看关联的故障/设备信息并可跳转
          </p>
        </div>
        <Space wrap>
          <Select
            value={source}
            onChange={(v) => setSource(v ?? "")}
            style={{ width: 150 }}
            options={[
              { value: "", label: "全部来源" },
              ...(cableEnabled ? [{ value: "cable", label: "仅线缆任务" }] : []),
              ...(deviceEnabled ? [{ value: "device", label: "仅设备任务" }] : []),
            ]}
          />
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<UnorderedListOutlined style={{ color: "#5B7FFF" }} />} onClick={() => navigate("/task/list")}>切换列表视图</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建任务</Button>
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
                {items.map((t) => {
                  const focused = searchParams.get("focus_task") === t.key;
                  const claimHint = t.source === "device" && t.status === "pending" && t.dispatch_mode !== "manual" && !t.assignee_id;
                  return (
                    <div key={t.key} onClick={() => { setCurrent(t); setAssignee(undefined); setVerdict(""); }}
                      style={{ cursor: "pointer", background: focused ? "#EAEFFF" : "#F6F8FE", outline: focused ? "2px solid #5B7FFF" : "none", border: `1px solid ${t.priority === 2 ? "#FCA5A5" : "#E4EAF6"}`, borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <SourceBadge source={t.source} />
                        <span style={{ flex: 1 }} />
                        {t.priority === 2
                          ? <span style={{ fontSize: 10.5, fontWeight: 600, color: "#EF4444" }}>紧急</span>
                          : t.priority === 1
                            ? <span style={{ fontSize: 10.5, fontWeight: 600, color: "#F59E0B" }}>高优</span>
                            : <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8A93A8" }}>普通</span>}
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: "#1E2433" }}>{t.title}</span>
                      <div style={{ fontSize: 10.5, color: "#8A93A8" }}>
                        {t.source === "cable"
                          ? (t.fault_id ? `故障 #${t.fault_id}${t.fault_type ? ` · ${t.fault_type}` : ""}` : `${t.task_no}`)
                          : `${t.device_name || "设备"}${t.device_code ? ` · ${t.device_code}` : ""}`}
                      </div>
                      <div style={{ fontSize: 11, color: "#5B6478" }}>
                        {t.assignee_name ? `${t.assignee_name} · ${t.scheduled_time ? t.scheduled_time.slice(5, 16) : ""}`
                          : claimHint ? "待领取（公开任务单）"
                          : `${t.task_no} · ${t.scheduled_time ? t.scheduled_time.slice(5, 16) : ""}`}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 22 }}>
                        <Tag style={{ borderRadius: 999, background: meta.bg, color: meta.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{meta.label}</Tag>
                        {status === "pending" && !claimHint && <Button size="small" type="primary" icon={<FlagOutlined />} onClick={(e) => { e.stopPropagation(); setCurrent(t); setAssignee(undefined); }}>派发</Button>}
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
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 派发/验收抽屉 */}
      <Drawer open={!!current} onClose={() => setCurrent(null)} width={520} title={current ? `${current.source === "device" ? "设备任务" : "任务"} ${current.task_no}` : ""}>
        {current && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 4 }}>
              <Descriptions.Item label="来源"><SourceBadge source={current.source} /></Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag style={{ borderRadius: 999, background: ST[current.status]?.bg, color: ST[current.status]?.fg, borderColor: "transparent" }}>{ST[current.status]?.label ?? current.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="标题">{current.title}</Descriptions.Item>
              <Descriptions.Item label="描述">{current.description || "—"}</Descriptions.Item>
              <Descriptions.Item label="维修人员">{current.assignee_name || "未派发"}</Descriptions.Item>
              {current.verdict && <Descriptions.Item label="结论">{current.verdict}</Descriptions.Item>}
              {current.cancel_reason && <Descriptions.Item label="取消原因">{current.cancel_reason}</Descriptions.Item>}
            </Descriptions>
            {renderLinkInfo(current)}
            {current.status === "pending" && !(current.source === "device" && current.dispatch_mode !== "manual" && !current.assignee_id) && (
              <Space>
                <Select placeholder="选择维修人员" style={{ width: 240 }} value={assignee} onChange={setAssignee} options={workers.map((w) => ({ value: w.id, label: w.name }))} />
                <Button type="primary" disabled={!assignee} onClick={() => doAssign(current, assignee)}>确认派发</Button>
              </Space>
            )}
            {current.status === "pending" && current.source === "device" && current.dispatch_mode !== "manual" && !current.assignee_id && (
              <div style={{ fontSize: 12, color: token.colorTextTertiary }}>公开任务单任务由维修人员在「设备维修任务」页自行领取。</div>
            )}
            {current.status === "done" && (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Input value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="验收结论（必填）" />
                <Button type="primary" disabled={!verdict.trim()} onClick={() => act(current, "verify", { verdict })}>验收通过</Button>
                <Popconfirm title="驳回该任务？" onConfirm={() => act(current, "reject", { verdict: "驳回重做" })}>
                  <Button danger>驳回</Button>
                </Popconfirm>
              </Space>
            )}
          </div>
        )}
      </Drawer>

      {/* 新建任务弹窗（看板页直接创建） */}
      <Modal open={open} onCancel={() => setOpen(false)} onOk={() => void createTask()} confirmLoading={saving} title="新建维修任务" width={560} destroyOnHidden afterOpenChange={(o) => { if (o) form.resetFields(); }}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Space>
            <Form.Item name="priority" label="优先级" initialValue={1}>
              <Select style={{ width: 140 }} options={[{ value: 1, label: "普通" }, { value: 2, label: "紧急" }]} />
            </Form.Item>
            {cableEnabled && (
              <Form.Item name="fault_id" label="关联故障（可选）">
                <Select style={{ width: 280 }} allowClear options={faults} showSearch optionFilterProp="label" />
              </Form.Item>
            )}
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
