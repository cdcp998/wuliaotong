/** knowledge 模块：知识库管理（/knowledge/write，knowledge:write/review）——草稿/发布/归档/AI 生成。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { App, Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined, RobotOutlined } from "@ant-design/icons";

import { knowledgeApi, type ArticleItem, type GenerateStatus } from "./api";

export function KnowledgeWritePage() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<ArticleItem[]>([]);
  const [loading, setLoading] = useState(false);
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
      // 轮询状态（success 返回 article_id）
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

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>知识库管理</Typography.Title>
        <Space>
          <Button icon={<RobotOutlined />} onClick={() => { setGenOpen(true); genForm.resetFields(); }}>AI 生成</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建知识</Button>
        </Space>
      </Space>
      <Alert style={{ marginBottom: 12 }} type="info" showIcon
        message="AI 生成结果一律为草稿，必须人工审核发布后才对维修人员可见（方案 §5.7）。" />
      <Table<ArticleItem>
        rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "标题", dataIndex: "title", ellipsis: true },
          { title: "分类", dataIndex: "category", width: 110, render: (v: string) => v || "—" },
          { title: "版本", dataIndex: "version", width: 90, render: (_, a) => `v${a.version}（发布 v${a.published_version || "—"}）` },
          { title: "来源", dataIndex: "author_type", width: 90, render: (v: string) => (v === "ai" ? <Tag color="purple">AI</Tag> : "人工") },
          { title: "状态", dataIndex: "status", width: 100, render: (v: number) => <Tag color={v === 1 ? "success" : v === 2 ? "default" : "orange"}>{["草稿", "已发布", "已归档"][v]}</Tag> },
          { title: "更新时间", dataIndex: "updated_at", width: 160, render: (v: string) => (v ? new Date(v).toLocaleString() : "—") },
          {
            title: "操作", width: 240,
            render: (_, a) => (
              <Space size={4}>
                <Button size="small" onClick={() => openEdit(a)}>编辑</Button>
                {a.status !== 1 && a.status !== 2 && (
                  <Button size="small" type="primary" onClick={() => publish(a)}>发布</Button>
                )}
                {a.status === 2 && <Button size="small" onClick={() => publish(a)}>恢复发布</Button>}
                {a.status !== 2 && (
                  <Popconfirm title="归档该知识？" onConfirm={() => archive(a)}>
                    <Button size="small">归档</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} title={editing ? "编辑知识" : "新建知识"} width={760} destroyOnHidden>
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

      <Modal open={genOpen} onCancel={() => { if (!genRunning) setGenOpen(false); }} onOk={startGenerate} confirmLoading={genRunning} title="AI 生成知识（草稿）" width={560} destroyOnHidden>
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
          <Alert type="error" showIcon message={`生成失败：${genTask.last_error}（可修改输入后重试）`} />
        )}
      </Modal>
    </div>
  );
}
