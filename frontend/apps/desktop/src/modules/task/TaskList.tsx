/** task 模块：任务列表（/task/list，task:dispatch/process）——创建/筛选/维修记录/知识推荐。
 *  v2 界面：玻璃表格 + 看板⇄列表切换 + 玻璃化弹窗/抽屉。 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, theme, Upload } from "antd";
import { PlusOutlined, UploadOutlined, UnorderedListOutlined, AppstoreOutlined, ReloadOutlined, RobotOutlined, FileTextOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { fileApi } from "@wlt/shared";

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
  useEffect(() => {
    cableApi.listFaults({ page_size: 100 }).then((r) => {
      setFaults(r.items.map((f) => ({ id: f.id, label: `#${f.id} ${f.fault_type || "故障"}（${["待处理", "处理中", "待验证", "已修复", "已关闭"][f.status] ?? f.status}）` })));
    }).catch(() => undefined);
  }, []);

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
    { title: "任务", width: 300, render: (_, t) => (
      <div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.title}</div>
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{t.task_no} · 创建 {t.creator_name} · {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</div>
      </div>
    ) },
    { title: "状态", width: 110, render: (_, t) => { const s = ST[t.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? t.status}</Tag>; } },
    { title: "优先级", width: 90, render: (_, t) => (t.priority === 2 ? <Tag color="red" style={{ borderRadius: 999 }}>紧急</Tag> : <Tag style={{ borderRadius: 999, color: "#64748B", background: "#EFF3FC", borderColor: "transparent" }}>普通</Tag>) },
    { title: "维修人员", dataIndex: "assignee_name", width: 120, render: (v: string) => v || <span style={{ color: token.colorTextTertiary }}>未派发</span> },
    { title: "计划时间", dataIndex: "scheduled_time", width: 130, render: (v: string | null) => v ? <span style={{ fontSize: 12 }}>{v.slice(0, 16)}</span> : <span style={{ color: token.colorTextTertiary }}>—</span> },
    {
      title: "操作", width: 180,
      render: (_, t) => (
        <Space size={4}>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => openRecords(t)}>记录</Button>
          {(t.status === "pending" || t.status === "assigned") && (
            <Popconfirm title="取消该任务（需填写原因）？" onConfirm={() => cancel(t)}>
              <Button size="small" danger>取消</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>任务列表</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>组合筛选：状态 / 优先级 / 维修人 / 时间范围；维修记录与知识推荐在「记录」抽屉内</p>
        </div>
        <Space>
          <div style={{ display: "inline-flex", padding: 3, gap: 0, background: "#F6F8FE", border: `1px solid ${token.colorBorder}`, borderRadius: 10 }}>
            <Button size="small" type="text" icon={<AppstoreOutlined />} onClick={() => navigate("/task/board")} style={{ borderRadius: 10 }}>看板</Button>
            <Button type="primary" size="small" icon={<UnorderedListOutlined />} style={{ borderRadius: 10 }}>列表</Button>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建任务</Button>
        </Space>
      </div>

      <div className="wlt-glass" style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 10px", flexWrap: "wrap" }}>
          <Input.Search placeholder="单号 / 标题" allowClear style={{ width: 260 }} onSearch={(v) => { setKeyword(v); setPage(1); }} />
          <Select placeholder="全部状态" allowClear style={{ width: 160 }} value={status || undefined} onChange={(v) => { setStatus(v ?? ""); setPage(1); }}
            options={Object.entries(ST).map(([k, v]) => ({ value: k, label: v.label }))} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>共 {total} 条</span>
        </div>
        <Table<TaskItem>
          rowKey="id" loading={loading} dataSource={rows} locale={{ emptyText: "暂无任务" }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); } }}
          columns={columns}
        />
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
            <Form.Item name="fault_id" label="关联故障（可选）">
              <Select style={{ width: 280 }} allowClear options={faults} showSearch optionFilterProp="label" />
            </Form.Item>
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
