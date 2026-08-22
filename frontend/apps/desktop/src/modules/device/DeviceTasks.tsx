/** device 模块：设备维修任务（/device/tasks，device:task）——创建/派发/接单/完成/验收/取消 + 维修记录。 */
import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from "antd";
import { PlusOutlined, UploadOutlined } from "@ant-design/icons";

import { adminApi, fileApi } from "@wlt/shared";

import { DEVICE_STATUS, DTASK_STATUS, deviceApi, type DeviceItem, type DeviceTaskItem } from "./api";

export function DeviceTasksPage() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<DeviceTaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [workers, setWorkers] = useState<{ id: number; name: string }[]>([]);
  const [current, setCurrent] = useState<DeviceTaskItem | null>(null);
  const [assignee, setAssignee] = useState<number | undefined>();
  const [verdict, setVerdict] = useState("");
  const [records, setRecords] = useState<Awaited<ReturnType<typeof deviceApi.records>>>([]);
  const [recContent, setRecContent] = useState("");
  const [recFile, setRecFile] = useState<File | null>(null);
  const [recSaving, setRecSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await deviceApi.listTasks({ status: filterStatus, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, page, pageSize, message]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    deviceApi.list({ page_size: 200 }).then((r) => setDevices(r.items)).catch(() => undefined);
    adminApi.users({ role_id: 6, status: 1, page_size: 200 })
      .then((r) => setWorkers(r.list.map((u) => ({ id: u.id, name: u.real_name || u.username }))))
      .catch(() => undefined);
  }, []);

  const create = async () => {
    const v = await form.validateFields();
    setCreating(true);
    try {
      await deviceApi.createTask({ device_id: v.device_id, title: v.title, description: v.description ?? "", priority: v.priority ?? 1 });
      message.success("任务已创建（设备自动置维修中）");
      setOpen(false);
      form.resetFields();
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const act = async (t: DeviceTaskItem, action: string, extra?: object) => {
    try {
      await deviceApi.taskStatus(t.id, { action, ...extra });
      message.success("已更新");
      setCurrent(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const openRecords = async (t: DeviceTaskItem) => {
    setCurrent(t);
    setRecords([]);
    setRecContent("");
    setRecFile(null);
    try {
      setRecords(await deviceApi.records(t.id));
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
        const up = await fileApi.upload(recFile, "device_task");
        fileId = up.file_id;
      }
      await deviceApi.addRecord(current.id, { content: recContent, files: fileId ? [{ file_id: fileId }] : [] });
      message.success("记录已保存");
      setRecContent("");
      setRecFile(null);
      setRecords(await deviceApi.records(current.id));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRecSaving(false);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>设备维修任务</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>新建任务</Button>
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <Select placeholder="状态" allowClear style={{ width: 150 }} value={filterStatus || undefined} onChange={(v) => { setFilterStatus(v ?? ""); setPage(1); }}
          options={Object.entries(DTASK_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
      </Space>
      <Table<DeviceTaskItem>
        rowKey="id" loading={loading} dataSource={rows}
        pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        columns={[
          { title: "单号", dataIndex: "task_no", width: 160 },
          { title: "设备", dataIndex: "device_name", width: 140, render: (v: string, t) => `${v}（${t.device_code}）` },
          { title: "标题", dataIndex: "title", ellipsis: true },
          { title: "状态", dataIndex: "status", width: 100, render: (v: string) => <Tag color={DTASK_STATUS[v]?.color}>{DTASK_STATUS[v]?.label ?? v}</Tag> },
          { title: "优先级", dataIndex: "priority", width: 90, render: (v: number) => (v === 2 ? <Tag color="red">紧急</Tag> : "普通") },
          { title: "维修人员", dataIndex: "assignee_name", width: 110, render: (v: string) => v || "—" },
          {
            title: "操作", width: 260,
            render: (_, t) => (
              <Space size={4}>
                <Button size="small" onClick={() => openRecords(t)}>记录</Button>
                {t.status === "pending" && <Button size="small" type="primary" onClick={() => { setCurrent(t); setAssignee(undefined); }}>派发</Button>}
                {t.status === "assigned" && <Button size="small" onClick={() => act(t, "accept")}>接单</Button>}
                {t.status === "in_progress" && <Button size="small" type="primary" onClick={() => act(t, "complete")}>完成</Button>}
                {t.status === "done" && <Button size="small" type="primary" onClick={() => { setCurrent(t); setVerdict(""); }}>验收</Button>}
                {t.status === "verified" && <Button size="small" onClick={() => act(t, "close")}>关闭</Button>}
                {(t.status === "pending" || t.status === "assigned") && (
                  <Popconfirm title="取消任务（设备状态将按快照回退）？" onConfirm={() => act(t, "cancel", { reason: "人工取消" })}>
                    <Button size="small" danger>取消</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal open={open} onCancel={() => setOpen(false)} onOk={create} confirmLoading={creating} title="新建设备维修任务" width={560} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="device_id" label="设备" rules={[{ required: true, message: "请选择设备" }]}>
            <Select showSearch optionFilterProp="label" options={devices.filter((d) => d.status !== 4).map((d) => ({ value: d.id, label: `${d.name}（${d.code}，${DEVICE_STATUS[d.status]?.label}）` }))} />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Form.Item name="priority" label="优先级" initialValue={1}>
            <Select style={{ width: 140 }} options={[{ value: 1, label: "普通" }, { value: 2, label: "紧急" }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer open={!!current} onClose={() => setCurrent(null)} width={560} title={current ? `设备任务：${current.title}` : ""}>
        {current && (
          <>
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {current.status === "pending" && (
                <Space>
                  <Select placeholder="选择维修人员" style={{ width: 220 }} value={assignee} onChange={setAssignee} options={workers.map((w) => ({ value: w.id, label: w.name }))} />
                  <Button type="primary" disabled={!assignee} onClick={() => act(current, "assign", { assignee_id: assignee })}>确认派发</Button>
                </Space>
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
              {current.verdict && <Typography.Text type="secondary">结论：{current.verdict}（设备状态回退至 {DEVICE_STATUS[current.previous_status]?.label ?? "在用"}）</Typography.Text>}
              {records.map((r) => (
                <Card key={r.id} size="small">
                  <div>{r.content || "（无文字记录）"}</div>
                  {r.files.map((f) => <img key={f.id} src={`/api/v1/files/${f.file_id}`} width={80} height={60} style={{ objectFit: "cover", borderRadius: 4, marginTop: 4 }} alt="" />)}
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
                </>
              )}
            </Space>
          </>
        )}
      </Drawer>
    </div>
  );
}
