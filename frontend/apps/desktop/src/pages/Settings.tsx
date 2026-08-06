import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, InputNumber, Radio, Space, Spin, Typography } from "antd";

import { systemApi, type Settings } from "@wlt/shared";

const EMPTY: Settings = {
  "site.name": "",
  "session.expire_hours": "8",
  "ocr.engine": "rapidocr",
  "bill.rule": "",
  "llm.doubao.api_key": "",
  "llm.doubao.base_url": "",
  "llm.doubao.model": "",
  "llm.deepseek.api_key": "",
  "llm.deepseek.base_url": "",
  "llm.deepseek.model": "",
  "auth.register_mode": "closed",
  "auth.forgot_method": "phone",
  "site.contact_phone": "",
  "smtp.host": "",
  "smtp.port": "465",
  "smtp.user": "",
  "smtp.password": "",
  "smtp.from": "",
};

/** 系统设置（电脑端）：与整体界面一致的 antd 表单风格。 */
export function SettingsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<Settings>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    systemApi
      .getSettings()
      .then((s) => form.setFieldsValue({ ...EMPTY, ...s }))
      .catch((e) => message.error(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [form, message]);

  async function save() {
    const values = form.getFieldsValue();
    setSaving(true);
    try {
      await systemApi.updateSettings(values);
      message.success("保存成功（密钥字段留空表示不修改）");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const keyField = (k: keyof Settings, label: string, opts?: { secret?: boolean; hint?: string; placeholder?: string }) => (
    <Form.Item
      key={k}
      name={k}
      label={label}
      extra={opts?.hint}
      rules={opts?.secret ? [{ pattern: /^\*{4}/, message: "密钥字段请留空（不修改）" }] : undefined}
    >
      <Input.Password
        autoComplete="new-password"
        placeholder={opts?.placeholder ?? (opts?.secret ? "填新值覆盖，留空不修改" : "")}
      />
    </Form.Item>
  );

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>系统设置</Typography.Title>
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" style={{ maxWidth: 640 }}>
          <Card title="通用" size="small" style={{ marginBottom: 16 }}>
            <Form.Item name="site.name" label="系统名称">
              <Input placeholder="物料通管理系统" />
            </Form.Item>
            <Form.Item name="session.expire_hours" label="会话有效期（小时）">
              <InputNumber style={{ width: 200 }} min={1} max={720} />
            </Form.Item>
          </Card>

          <Card title="OCR 引擎" size="small" style={{ marginBottom: 16 }}>
            <Form.Item name="ocr.engine" label="识别引擎">
              <Radio.Group
                options={[
                  { value: "rapidocr", label: "RapidOCR-json（Windows 本地）" },
                  { value: "paddle", label: "PaddleOCR（Debian/Linux）" },
                ]}
              />
            </Form.Item>
            <Form.Item name="bill.rule" label="单据编号规则" extra="格式：前缀列表，用 | 分隔">
              <Input placeholder="RK|LL|DB|PD|QT|QCK" />
            </Form.Item>
          </Card>

          <Card title="豆包大模型（视觉识别材料，支持外网/内网 API）" size="small" style={{ marginBottom: 16 }}>
            {keyField("llm.doubao.api_key", "API Key", { secret: true, placeholder: "填新 Key 覆盖，留空不修改" })}
            <Form.Item name="llm.doubao.base_url" label="Base URL"><Input placeholder="https://ark.cn-beijing.volces.com/api/v3" /></Form.Item>
            <Form.Item name="llm.doubao.model" label="模型"><Input placeholder="doubao-1-5-vision-pro-32k-250115" /></Form.Item>
          </Card>

          <Card title="DeepSeek（送货单文本结构化）" size="small" style={{ marginBottom: 16 }}>
            {keyField("llm.deepseek.api_key", "API Key", { secret: true, placeholder: "填新 Key 覆盖，留空不修改" })}
            <Form.Item name="llm.deepseek.base_url" label="Base URL"><Input placeholder="https://api.deepseek.com/v1" /></Form.Item>
            <Form.Item name="llm.deepseek.model" label="模型"><Input placeholder="deepseek-chat" /></Form.Item>
          </Card>

          <Card title="注册与找回密码" size="small" style={{ marginBottom: 16 }}>
            <Form.Item name="auth.register_mode" label="注册模式">
              <Radio.Group
                options={[
                  { value: "open", label: "开放注册（注册即开通使用者账号）" },
                  { value: "review", label: "审核注册（管理员审核通过后开通）" },
                  { value: "closed", label: "关闭注册（仅管理员建号）" },
                ]}
              />
            </Form.Item>
            <Form.Item name="auth.forgot_method" label="忘记密码找回方式">
              <Radio.Group
                options={[
                  { value: "email", label: "邮箱找回（发送重置验证码邮件，需配置下方 SMTP）" },
                  { value: "phone", label: "联系管理员电话找回（展示联系电话）" },
                  { value: "both", label: "两者均可（有邮箱优先邮箱）" },
                ]}
              />
            </Form.Item>
            <Form.Item name="site.contact_phone" label="管理员联系电话（电话找回时展示给用户）">
              <Input placeholder="如 13800001111" />
            </Form.Item>
          </Card>

          <Card title="SMTP 邮件服务（邮箱找回用）" size="small" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Form.Item name="smtp.host" label="服务器地址" style={{ marginBottom: 12 }}>
                <Input placeholder="如 smtp.qq.com" />
              </Form.Item>
              <Form.Item name="smtp.port" label="端口" style={{ marginBottom: 12 }}>
                <InputNumber style={{ width: 200 }} min={1} max={65535} />
              </Form.Item>
              <Form.Item name="smtp.user" label="账号" style={{ marginBottom: 12 }}>
                <Input placeholder="SMTP 账号" />
              </Form.Item>
              {keyField("smtp.password", "密码/授权码", { secret: true, placeholder: "填新值覆盖，留空不修改" })}
              <Form.Item name="smtp.from" label="发件人邮箱（缺省用账号）" style={{ marginBottom: 12 }}>
                <Input placeholder="发件邮箱" />
              </Form.Item>
            </Space>
          </Card>

          <Button type="primary" size="large" loading={saving} onClick={() => void save()} style={{ minWidth: 160 }}>
            保存设置
          </Button>
        </Form>
      </Spin>
    </div>
  );
}
