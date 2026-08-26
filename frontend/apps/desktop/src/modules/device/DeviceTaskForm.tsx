/** device 模块：设备维修任务创建表单（可复用）。
 *  供两处嵌入：①「设备维修任务」页新建弹窗；②任务管理「发布任务」弹窗的设备任务标签页
 *  （跨模块直接调用本模块的创建界面）。v1.2 起统一手动派发——公开领取模式已随
 *  设备自有任务池移除，派发在任务管理统一任务池/本列表进行。 */
import { useEffect, useState } from "react";
import { App, Button, Form, Input, Select, Space } from "antd";

import { DEVICE_STATUS, deviceApi, type DeviceItem } from "./api";

export function DeviceTaskForm({ onSubmitted, onCancel }: {
  /** 创建成功回调（父级负责关弹窗/跳转）。 */
  onSubmitted?: () => void;
  onCancel?: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // page_size 上限为后端 le=100（超限会被 422 拒绝导致下拉为空）
    deviceApi.list({ page_size: 100 })
      .then((r) => setDevices(r.items))
      .catch((e) => message.error(e instanceof Error ? `设备列表加载失败：${e.message}` : "设备列表加载失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const v = await form.validateFields();
    setCreating(true);
    try {
      await deviceApi.createTask({
        device_id: v.device_id, title: v.title, description: v.description ?? "",
        priority: v.priority ?? 1,
      });
      message.success("设备任务已发布（设备自动置维修中），请在任务管理统一任务池派发维修人员");
      form.resetFields();
      onSubmitted?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
      <Form.Item name="device_id" label="设备" rules={[{ required: true, message: "请选择设备" }]}>
        <Select showSearch optionFilterProp="label" placeholder="选择待维修设备"
          options={devices.filter((d) => d.status !== 4).map((d) => ({ value: d.id, label: `${d.name}（${d.code}，${DEVICE_STATUS[d.status]?.label ?? "未知"}）` }))} />
      </Form.Item>
      <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
        <Input maxLength={100} />
      </Form.Item>
      <Form.Item name="description" label="描述">
        <Input.TextArea rows={3} maxLength={500} />
      </Form.Item>
      <Space wrap>
        <Form.Item name="priority" label="优先级" initialValue={1}>
          <Select style={{ width: 140 }} options={[{ value: 1, label: "普通" }, { value: 2, label: "紧急" }]} />
        </Form.Item>
      </Space>
      <div style={{ fontSize: 11.5, color: "#6A748A", marginBottom: 8 }}>
        任务发布后进入「任务管理 · 统一任务池」，由调度员在看板/列表派发维修人员。
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6, borderTop: "1px solid #E4EAF6", paddingTop: 12 }}>
        <Button style={{ width: 120 }} onClick={onCancel}>取消</Button>
        <Button type="primary" loading={creating} style={{ flex: 1 }} onClick={() => void submit()}>发布设备任务</Button>
      </div>
    </Form>
  );
}
