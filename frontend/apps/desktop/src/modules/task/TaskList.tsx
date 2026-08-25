/** task 模块：任务列表（/task/list，task:dispatch/process）——创建/筛选/维修记录/知识推荐。
 *  v2 界面：玻璃表格 + 看板⇄列表切换 + 玻璃化弹窗/抽屉。 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, theme, Upload } from "antd";
import { PlusOutlined, UploadOutlined, AppstoreOutlined, RobotOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { fileApi, useAuthStore } from "@wlt/shared";

import { cableApi } from "../cable/api";
import { taskApi, type TaskItem } from "./api";

const ST: Record<string, { label: string; fg: string; bg: string }> = {
  pending: { label: "待派发", fg: "#B45309", bg: "#FEF4E2" },
  assigned: { label: "已派发", fg: "#3B5BDB", bg: "#EAEFFF" },
  in_progress: { label: "进行中", fg: "#0E7490", bg: "#E0F2FE" },
  done: { label: "完成待验", fg: "#7C3AED", bg: "#F3E8FF" },
  verified: { label: "已验证", fg: "#15803D", bg: "#E8F9EF" },
  closed: { label: "已关闭", fg: "#64748B", bg: "#EFF3FC" },
  cancelled: { label: "已取消", fg: "#DC2626", bg: "#FDEBEC" },
};

export function TaskListPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [faults, setFaults] = useState<{ id: number; label: string }[]>([]);
  const [current, setCurrent] = useState<TaskItem | null>(null);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof taskApi.records>>>([]);
  const [recContent, setRecContent] = useState("");
  const [recFile, setRecFile] = useState<File | null>(null);
  const [recSaving, setRecSaving] = useState(false);
  const [recommend, setRecommend] = useState<{ id: number; title: string; snippet: string }[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await taskApi.list({ status, keyword, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [status, keyword, page, pageSize, message]);

  useEffect(() => { void load(); }, [load]);
  // cable 未启用时「关联故障」字段隐藏，无需拉取故障下拉
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const cableEnabled = moduleEnabled("cable");
  useEffect(() => {
    if (!cableEnabled) return;
    cableApi.listFaults({ page_size: 100 }).then((r) => {
      setFaults(r.items.map((f) => ({ id: f.id, label: `#${f.id} ${f.fault_type || "故障"}（${["待处理", "处理中", "待验证", "已修复", "已关闭"][f.status] ?? f.status}）` })));
    }).catch(() => undefined);
  }, [cableEnabled]);

  const save = async () => {
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

  const cancel = async (t: TaskItem) => {
    try {
      await taskApi.status(t.id, { action: "cancel", reason: "人工取消" });
      message.success("已取消");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "取消失败");
    }
  };

  const openRecords = async (t: TaskItem) => {
    setCurrent(t);
    setRecContent("");
    setRecFile(null);
    setRecommend([]);
    try {
      setRecords(await taskApi.records(t.id));
    } catch {
      setRecords([]);
    }
  };

  const addRecord = async () => {
    if (!current) return;
    setRecSaving(true);
    try {
      let fileId = 0;
      if (recFile) {
        const up = await fileApi.upload(recFile, "task");
        fileId = up.file_id;
      }
      await taskApi.addRecord(current.id, { content: recContent, files: fileId ? [{ file_id: fileId }] : [] });
      message.success("记录已保存");
      setRecContent("");
      setRecFile(null);
      setRecords(await taskApi.records(current.id));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRecSaving(false);
    }
  };

  const doRecommend = async () => {
    if (!current) return;
    try {
      const r = await taskApi.recommend(current.id);
      setRecommend(r.items ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "推荐失败");
    }
  };

  const columns: ColumnsType<TaskItem> = [
    { title: "任务", key: "task", width: 260, render: (_, t) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: "#1E2433" }}>{t.title}</div>
        <div style={{ fontSize: 10.5, color: "#8A93A8", marginTop: 2 }}>{t.task_no}</div>
      </div>
    ) },
    {
      title: "优先", key: "priority", width: 100,
      render: (_, t) => {
        const m = t.priority === 2 ? { label: "紧急", fg: "#DC2626", bg: "#FDEBEC" } : t.priority === 1 ? { label: "高优", fg: "#B45309", bg: "#FEF4E2" } : { label: "普通", fg: "#64748B", bg: "#EFF3FC" };
        return <Tag style={{ borderRadius: 999, background: m.bg, color: m.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{m.label}</Tag>;
      },
    },
    { title: "负责人", dataIndex: "assignee_name", width: 110, render: (v: string) => v || <span style={{ color: "#8A93A8", fontSize: 12 }}>—</span> },
    { title: "状态", key: "status", width: 110, render: (_, t) => { const s = ST[t.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? t.status}</Tag>; } },
    { title: "排期", dataIndex: "scheduled_time", width: 130, render: (v: string | null) => v ? <span style={{ fontSize: 12, color: "#8A93A8", fontVariantNumeric: "tabular-nums" }}>{v.slice(0, 16)}</span> : <span style={{ color: "#8A93A8", fontSize: 12 }}>—</span> },
    { title: "来源", key: "src", width: 120, render: (_, t) => <span style={{ fontSize: 12, color: "#5B6478" }}>{t.fault_id ? `故障 #${t.fault_id}` : "人工派单"}</span> },
    {
      title: "操作", width: 180,
      render: (_, t) => (
        <Space size={10} style={{ padding: "0 10px" }}>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#5B6478" }} onClick={() => openRecords(t)}>记录</Button>
          {t.status === "done" && (
            <>
              <Popconfirm title="验收通过该任务？" onConfirm={() => void act(t, "verify", { verdict: "验收通过" })}>
                <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#15803D" }}>验收</Button>
              </Popconfirm>
              <Popconfirm title="驳回该任务？" onConfirm={() => void act(t, "reject", { verdict: "驳回重做" })}>
                <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#DC2626" }}>驳回</Button>
              </Popconfirm>
            </>
          )}
          {(t.status === "pending" || t.status === "assigned") && (
            <Popconfirm title="取消该任务（需填写原因）？" onConfirm={() => cancel(t)}>
              <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#DC2626" }}>取消</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  /** 统一状态操作（验收/驳回等）。 */
  const act = async (t: TaskItem, action: string, extra?: object) => {
    try {
      await taskApi.status(t.id, { action, ...extra });
      message.success("已更新");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 45） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>维修任务列表</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            全量任务：状态筛选 / 优先 / 负责人 / 排期；记录、知识推荐、验收与关闭
          </p>
        </div>
        <Space>
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<AppstoreOutlined style={{ color: "#5B7FFF" }} />} onClick={() => navigate("/task/board")}>切换看板视图</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建任务</Button>
        </Space>
      </div>

      {/* 筛选条（设计页 45） */}
      <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#8A93A8" }} />}
          placeholder="任务单号 / 内容"
          allowClear
          style={{ width: 300, background: "#F6F8FE" }}
          onChange={(e) => { if (!e.target.value) { setKeyword(""); setPage(1); } }}
          onPressEnter={(e) => { setKeyword((e.target as HTMLInputElement).value.trim()); setPage(1); }}
        />
        <Select placeholder="全部状态" allowClear style={{ width: 160 }} value={status || undefined} onChange={(v) => { setStatus(v ?? ""); setPage(1); }}
          options={Object.entries(ST).map(([k, v]) => ({ value: k, label: v.label }))} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A93A8" }}>共 {total} 条</span>
      </div>

      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<TaskItem>
          rowKey="id" loading={loading} dataSource={rows} locale={{ emptyText: "暂无任务" }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); } }}
          columns={columns}
        />
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#8A93A8" }}>
          提示：知识推荐在任务记录抽屉内；完成需填写记录并上传现场照片（GPS+水印）
        </p>
      </div>

      {/* 新建任务 */}
      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} title="新建维修任务" width={560} destroyOnHidden>
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

      {/* 维修记录抽屉 */}
      <Drawer open={!!current} onClose={() => setCurrent(null)} width={560} title={current ? `维修记录：${current.title}` : ""}>
        {current && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {records.map((r) => (
              <div key={r.id} className="wlt-glass-sm" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13 }}>{r.content || "（无文字记录）"}</div>
                {r.files.length > 0 && (
                  <Space wrap>
                    {r.files.map((f) => <img key={f.id} src={`/api/v1/files/${f.file_id}`} width={80} height={60} style={{ objectFit: "cover", borderRadius: 10 }} alt="" />)}
                  </Space>
                )}
                <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>{new Date(r.created_at).toLocaleString()}</div>
              </div>
            ))}
            {!(current.status === "in_progress" || current.status === "assigned") && <div style={{ color: token.colorTextTertiary, textAlign: "center", padding: 12 }}>该任务当前状态不可追加维修记录</div>}
            {(current.status === "in_progress" || current.status === "assigned") && (
              <>
                <Input.TextArea rows={3} value={recContent} onChange={(e) => setRecContent(e.target.value)} placeholder="维修内容" />
                <Upload beforeUpload={(f) => { setRecFile(f); return false; }} maxCount={1} accept="image/*" showUploadList={false}>
                  <Button icon={<UploadOutlined />}>{recFile ? "已选照片（点击更换）" : "选择维修照片（完成必填）"}</Button>
                </Upload>
                <Button type="primary" loading={recSaving} onClick={addRecord}>保存记录</Button>
                <Button icon={<RobotOutlined />} onClick={doRecommend}>知识推荐</Button>
                {recommend.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>推荐知识</span>
                    {recommend.map((a) => <div key={a.id} className="wlt-glass-sm" style={{ padding: 10 }}>{a.title}</div>)}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
