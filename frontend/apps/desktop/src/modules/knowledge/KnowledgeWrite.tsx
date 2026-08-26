/** knowledge 模块：知识库管理（/knowledge/write，knowledge:write/review）——草稿/发布/归档/AI 生成。
 *  v2 界面：状态胶囊 Tabs + 玻璃表格（与设计稿一致）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, theme } from "antd";
import { PlusOutlined, RobotOutlined, ReloadOutlined, CheckOutlined, InboxOutlined, EditOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { knowledgeApi, type ArticleItem, type GenerateStatus } from "./api";

const STATUS_META: Record<number, { label: string; fg: string; bg: string }> = {
  0: { label: "草稿", fg: "#B45309", bg: "#FEF4E2" },
  1: { label: "已发布", fg: "#15803D", bg: "#E8F9EF" },
  2: { label: "已归档", fg: "#475569", bg: "#EFF3FC" },
};

export function KnowledgeWritePage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [rows, setRows] = useState<ArticleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<number | "">("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ArticleItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genTask, setGenTask] = useState<GenerateStatus | null>(null);
  const [genRunning, setGenRunning] = useState(false);
  const timer = useRef<number | null>(null);
  const [form] = Form.useForm();
  const [genForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await knowledgeApi.list({ page_size: 100 });
      setRows(r.items);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => { void load(); return () => { if (timer.current) window.clearInterval(timer.current); }; }, [load]);

  const counts = useMemo(() => ({
    all: rows.length,
    draft: rows.filter((r) => r.status === 0).length,
    published: rows.filter((r) => r.status === 1).length,
    archived: rows.filter((r) => r.status === 2).length,
  }), [rows]);

  const filtered = useMemo(() => rows.filter((r) => statusFilter === "" || r.status === statusFilter), [rows, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };
  const openEdit = (a: ArticleItem) => {
    setEditing(a);
    form.setFieldsValue({ title: a.title, content: a.content, category: a.category, tags: a.tags?.join(",") });
    setOpen(true);
  };

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const tags = (v.tags ?? "").split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
      if (editing) {
        await knowledgeApi.update(editing.id, { title: v.title, content: v.content, category: v.category, tags });
        message.success("已保存（已发布内容将回到草稿待审核）");
      } else {
        await knowledgeApi.create({ title: v.title, content: v.content, category: v.category ?? "", tags });
        message.success("草稿已创建");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const publish = async (a: ArticleItem) => {
    try {
      await knowledgeApi.publish(a.id);
      message.success("已发布");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "发布失败");
    }
  };
  const archive = async (a: ArticleItem) => {
    try {
      await knowledgeApi.archive(a.id);
      message.success("已归档");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "归档失败");
    }
  };

  const startGenerate = async () => {
    const v = await genForm.validateFields();
    setGenRunning(true);
    setGenTask(null);
    try {
      const r = await knowledgeApi.generate({ title: v.title ?? "", topic: v.topic, context: v.context ?? "" });
      const taskId = r.task_id;
      timer.current = window.setInterval(async () => {
        try {
          const st = await knowledgeApi.generateStatus(taskId);
          setGenTask(st);
          if (st.status === "success" || st.status === "failed") {
            if (timer.current) window.clearInterval(timer.current);
            setGenRunning(false);
            if (st.status === "success") {
              message.success("AI 生成完成（草稿，待人工审核）");
              setGenOpen(false);
              void load();
            } else {
              message.warning(`生成失败（重试 ${st.retry_count} 次）：${st.last_error}`);
            }
          }
        } catch {
          /* 轮询失败下一轮重试 */
        }
      }, 2000);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交生成失败");
      setGenRunning(false);
    }
  };

  const columns: ColumnsType<ArticleItem> = [
    { title: "知识条目", width: 320, render: (_, a) => (
      <div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.title}</div>
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{a.category || "未分类"} · {a.author_type === "ai" ? "AI 生成" : "人工编写"}</div>
      </div>
    ) },
    { title: "版本", width: 130, render: (_, a) => <span style={{ fontSize: 12 }}>v{a.version}（发布 v{a.published_version || "—"}）</span> },
    { title: "来源", width: 100, render: (_, a) => (a.author_type === "ai" ? <Tag color="purple" style={{ borderRadius: 999 }}>AI</Tag> : <Tag style={{ borderRadius: 999 }}>人工</Tag>) },
    { title: "状态", width: 110, render: (_, a) => { const s = STATUS_META[a.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? a.status}</Tag>; } },
    { title: "更新时间", dataIndex: "updated_at", width: 150, render: (v: string) => (v ? <span style={{ fontSize: 12 }}>{new Date(v).toLocaleString()}</span> : <span style={{ color: token.colorTextTertiary }}>—</span>) },
    {
      title: "操作", width: 220,
      render: (_, a) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(a)}>编辑</Button>
          {a.status !== 1 && a.status !== 2 && <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => publish(a)}>发布</Button>}
          {a.status === 2 && <Button size="small" onClick={() => publish(a)}>恢复发布</Button>}
          {a.status !== 2 && (
            <Popconfirm title="归档该知识？" onConfirm={() => archive(a)}>
              <Button size="small" icon={<InboxOutlined />}>归档</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>知识库管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>知识条目的新建 / 编辑 / 审核发布；AI 生成结果一律落草稿，人工审核后方可发布</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button icon={<RobotOutlined />} onClick={() => { setGenOpen(true); genForm.resetFields(); }}>AI 生成</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建知识</Button>
        </Space>
      </div>

      <Alert style={{ marginBottom: 14 }} type="info" showIcon
        title="AI 生成结果一律为草稿，必须人工审核发布后才对维修人员可见。" />

      {/* 状态 Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {([["", "全部", counts.all], [0, "草稿", counts.draft], [1, "已发布", counts.published], [2, "已归档", counts.archived]] as const).map(([st, label, count]) => {
          const active = statusFilter === st;
          return (
            <button key={String(st)} type="button" onClick={() => setStatusFilter(st as number | "")}
              style={{ cursor: "pointer", border: `1px solid ${active ? "#5B7FFF" : token.colorBorder}`, background: active ? "#5B7FFF" : "#fff", color: active ? "#fff" : token.colorTextSecondary, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: active ? 600 : 500, display: "inline-flex", gap: 6, alignItems: "center", fontFamily: "inherit", transition: "all .2s ease" }}>
              {label} <span style={{ opacity: 0.75, fontWeight: 600 }}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<ArticleItem>
          rowKey="id" loading={loading} dataSource={filtered} locale={{ emptyText: "暂无知识条目" }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          columns={columns}
        />
      </div>

      {/* 新建/编辑 */}
      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} title={editing ? "编辑知识" : "新建知识"} width={760} destroyOnHidden forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Space>
            <Form.Item name="category" label="分类">
              <Select style={{ width: 200 }} allowClear options={["光缆", "电线", "网络", "熔接", "终端"].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="tags" label="标签（逗号分隔）">
              <Input style={{ width: 320 }} placeholder="接线盒,进水" />
            </Form.Item>
          </Space>
          <Form.Item name="content" label="正文（Markdown）" rules={[{ required: true, message: "请输入正文" }]}>
            <Input.TextArea rows={12} />
          </Form.Item>
        </Form>
      </Modal>

      {/* AI 生成 */}
      <Modal open={genOpen} onCancel={() => { if (!genRunning) setGenOpen(false); }} onOk={startGenerate} confirmLoading={genRunning} title="AI 生成知识（草稿）" width={560} destroyOnHidden forceRender>
        <Form form={genForm} layout="vertical">
          <Form.Item name="topic" label="生成主题（故障/场景）" rules={[{ required: true, message: "请输入主题" }]}>
            <Input placeholder="如：光缆接线盒进水处理" />
          </Form.Item>
          <Form.Item name="title" label="标题（可选）">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="context" label="补充背景（可选）">
            <Input.TextArea rows={3} maxLength={5000} placeholder="现场描述/故障类型/线缆类型…" />
          </Form.Item>
        </Form>
        {genTask?.status === "failed" && genTask.last_error && (
          <Alert type="error" showIcon title={`生成失败：${genTask.last_error}（可修改输入后重试）`} />
        )}
      </Modal>
    </div>
  );
}
