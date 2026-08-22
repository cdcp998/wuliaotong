/** task 模块：任务列表（/task/list，task:dispatch/process）——创建/筛选/维修记录/知识推荐。 */
import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from "antd";
import { PlusOutlined, UploadOutlined } from "@ant-design/icons";

import { fileApi } from "@wlt/shared";

import { cableApi } from "../cable/api";
import { STATUS_LABEL, taskApi, type TaskItem } from "./api";

export function TaskListPage() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
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

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>任务列表</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建任务</Button>
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <Input.Search placeholder="单号/标题" allowClear style={{ width: 240 }} onSearch={(v) => { setKeyword(v); setPage(1); }} />
        <Select placeholder="状态" allowClear style={{ width: 150 }} value={status || undefined} onChange={(v) => { setStatus(v ?? ""); setPage(1); }}
          options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v.label }))} />
      </Space>
      <Table<TaskItem>
        rowKey="id" loading={loading} dataSource={rows}
        pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        columns={[
          { title: "单号", dataIndex: "task_no", width: 150 },
          { title: "标题", dataIndex: "title" },
          { title: "状态", dataIndex: "status", width: 100, render: (v: string) => <Tag color={STATUS_LABEL[v]?.color}>{STATUS_LABEL[v]?.label ?? v}</Tag> },
          { title: "优先级", dataIndex: "priority", width: 90, render: (v: number) => (v === 2 ? <Tag color="red">紧急</Tag> : "普通") },
          { title: "维修人员", dataIndex: "assignee_name", width: 110, render: (v: string) => v || "—" },
          { title: "创建人", dataIndex: "creator_name", width: 100 },
          { title: "创建时间", dataIndex: "created_at", width: 160, render: (v: string) => (v ? new Date(v).toLocaleString() : "—") },
          {
            title: "操作", width: 220,
            render: (_, t) => (
              <Space size={4}>
                <Button size="small" onClick={() => openRecords(t)}>记录</Button>
                {(t.status === "pending" || t.status === "assigned") && (
                  <Popconfirm title="取消该任务（需填写原因）？" onConfirm={() => cancel(t)}>
                    <Button size="small" danger>取消</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

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

      <Drawer open={!!current} onClose={() => setCurrent(null)} width={560} title={current ? `维修记录：${current.title}` : ""}>
        {current && (
          <>
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {records.map((r) => (
                <Card key={r.id} size="small">
                  <div>{r.content || "（无文字记录）"}</div>
                  {r.files.length > 0 && (
                    <Space wrap style={{ marginTop: 6 }}>
                      {r.files.map((f) => <img key={f.id} src={`/api/v1/files/${f.file_id}`} width={80} height={60} style={{ objectFit: "cover", borderRadius: 4 }} alt="" />)}
                    </Space>
                  )}
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{new Date(r.created_at).toLocaleString()}</div>
                </Card>
              ))}
              {(current.status === "in_progress" || current.status === "assigned") && (
                <>
                  <Input.TextArea rows={3} value={recContent} onChange={(e) => setRecContent(e.target.value)} placeholder="维修内容" />
                  <Upload beforeUpload={(f) => { setRecFile(f); return false; }} maxCount={1} accept="image/*" showUploadList={false}>
                    <Button icon={<UploadOutlined />}>{recFile ? "已选照片（点击更换）" : "选择维修照片（完成必填）"}</Button>
                  </Upload>
                  <Button type="primary" loading={recSaving} onClick={addRecord}>保存记录</Button>
                  <Button onClick={doRecommend}>知识推荐</Button>
                  {recommend.length > 0 && (
                    <Space direction="vertical" size={4}>
                      {recommend.map((a) => <Card key={a.id} size="small">{a.title}</Card>)}
                    </Space>
                  )}
                </>
              )}
            </Space>
          </>
        )}
      </Drawer>
    </div>
  );
}
