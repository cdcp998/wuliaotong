import { useEffect, useRef, useState } from "react";
import { App, Alert, Button, Form, Input, InputNumber, Modal, Radio, Select, Space, Spin, Switch, Tabs, Tag, Typography } from "antd";

import { systemApi, type OcrInstallState, type Settings } from "@wlt/shared";

const EMPTY: Settings = {
  "site.name": "",
  "session.expire_hours": "8",
  "ocr.engine": "paddle",
  "ocr.model_version": "PP-OCRv6",
  "llm.doubao.enabled": "1",
  "llm.deepseek.enabled": "1",
  "bill.rule": "",
  "watermark.template": "",
  "watermark.position": "bottom",
  "watermark.bg_opaque": "1",
  "log.level": "INFO",
  "llm.doubao.api_key": "",
  "llm.doubao.base_url": "",
  "llm.doubao.model": "",
  "llm.deepseek.api_key": "",
  "llm.deepseek.base_url": "",
  "llm.deepseek.model": "",
  "llm.siliconflow.enabled": "1",
  "llm.siliconflow.api_key": "",
  "llm.siliconflow.base_url": "https://api.siliconflow.cn/v1",
  "llm.siliconflow.model": "",
  "auth.register_mode": "closed",
  "auth.forgot_method": "phone",
  "site.contact_phone": "",
  "smtp.host": "",
  "smtp.port": "465",
  "smtp.user": "",
  "smtp.password": "",
  "smtp.from": "",
};

/** 表单值统一转字符串：InputNumber 字段（会话有效期/端口）返回 number、清空返回 null，
 *  而 PUT /settings 契约是全字符串（后端 dict[str,str] 校验，非字符串返回 4006 保存失败）。 */
function toStrings(values: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k as keyof Settings] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

/** 系统设置（电脑端）：按功能分类平铺（Tabs），所有设置项一目了然。 */
export function SettingsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<Settings>();
  const ocrEngine = Form.useWatch("ocr.engine", form);
  // 模型字段在 Space.Compact 内，antd v6 Form.Item 只注入 value/onChange 给直接子元素（Space.Compact 不透传），
  // Select 拿不到表单绑定会变成非受控（选中不写 store、回显失效）→ 显式受控绑定 form
  const doubaoModel = Form.useWatch("llm.doubao.model", form);
  const dsModel = Form.useWatch("llm.deepseek.model", form);
  const sfModel = Form.useWatch("llm.siliconflow.model", form);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);
  // SiliconFlow 模型列表（保存 API Key 后拉取，供选择模型）
  const [sfModels, setSfModels] = useState<{ id: string; owned_by: string }[]>([]);
  const [sfLoading, setSfLoading] = useState(false);
  // DeepSeek（文本模型）模型列表
  const [dsModels, setDsModels] = useState<{ id: string; owned_by: string }[]>([]);
  const [dsLoading, setDsLoading] = useState(false);
  // 豆包模型列表
  const [doubaoModels, setDoubaoModels] = useState<{ id: string; owned_by: string }[]>([]);
  const [doubaoLoading, setDoubaoLoading] = useState(false);
  // PP-OCR 自动安装状态（后台线程安装，前端轮询）
  const [installState, setInstallState] = useState<OcrInstallState>({ status: "idle", log: "" });
  const installTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    systemApi.installStatus().then(setInstallState).catch(() => undefined);
    return () => {
      if (installTimer.current) clearInterval(installTimer.current);
    };
  }, []);

  useEffect(() => {
    if (installState.status === "installing") {
      if (installTimer.current) clearInterval(installTimer.current);
      installTimer.current = setInterval(() => {
        void systemApi.installStatus().then(setInstallState).catch(() => undefined);
      }, 3000);
    } else if (installTimer.current) {
      clearInterval(installTimer.current);
      installTimer.current = undefined;
    }
  }, [installState.status]);

  async function startInstallPaddle() {
    try {
      const s = await systemApi.installPaddle();
      setInstallState(s);
      message.success(installState.status === "done" ? "已开始重新安装 PP-OCR（paddlepaddle + paddleocr），请稍候…" : "已开始自动安装 PP-OCR（paddlepaddle + paddleocr），请稍候…");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "启动安装失败");
    }
  }

  useEffect(() => {
    setLoading(true);
    systemApi
      .getSettings()
      .then((s) => {
        // 数据库未配置的键 GET 返回空串，会覆盖 EMPTY 默认值（如 llm.*.enabled 默认"1"）
        // 导致开关显示开（"" !== "0"）但存储值是空串。空值回退 EMPTY 默认，保证显示与存储一致
        const merged = { ...EMPTY };
        for (const [k, v] of Object.entries(s)) {
          if (v !== "") merged[k as keyof Settings] = v;
        }
        form.setFieldsValue(merged);
      })
      .catch((e) => message.error(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [form, message]);

  async function save() {
    const values = form.getFieldsValue();
    setSaving(true);
    try {
      await systemApi.updateSettings(toStrings(values));
      message.success("保存成功（密钥字段留空表示不修改）");
      // 注意：保存后不再自动获取模型列表——拉取会用已保存 Key 替换下拉 options，
      // 已选模型不在新列表时会被清空显示（用户反馈 BUG）。模型列表仅在点「获取模型列表」按钮时拉取。
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  type LlmKind = "siliconflow" | "deepseek" | "doubao";

  const LLM_META: Record<LlmKind, { label: string; enableLabel: string; api: () => Promise<{ models: { id: string; owned_by: string }[] }> }> = {
    siliconflow: { label: "视觉模型", enableLabel: "启用视觉模型", api: systemApi.listSiliconflowModels },
    deepseek: { label: "文本模型", enableLabel: "启用文本模型", api: systemApi.listDeepseekModels },
    doubao: { label: "豆包大模型", enableLabel: "启用豆包大模型", api: systemApi.listDoubaoModels },
  };

  async function fetchModelList(kind: LlmKind, opts?: { skipCheck?: boolean }) {
    const meta = LLM_META[kind];
    const v = form.getFieldsValue();
    if (!opts?.skipCheck) {
      // 未启用（显式 "0"）→ 明确提示；空值视为启用（与 Switch 显示逻辑 v !== "0" 一致）
      if (v[`llm.${kind}.enabled`] === "0") {
        message.warning(`${meta.label}未启用：请先打开「${meta.enableLabel}」开关并保存，再获取模型列表`);
        return;
      }
      const key = v[`llm.${kind}.api_key`];
      if (!key) {
        message.warning(`未填写${meta.label} API Key：请先填写并保存，再获取模型列表`);
        return;
      }
      if (!key.startsWith("****")) {
        setSaving(true);
        try {
          await systemApi.updateSettings(toStrings(v));
          message.success("设置已保存，正在获取模型列表…");
        } catch (e) {
          message.error(e instanceof Error ? e.message : "保存失败");
          setSaving(false);
          return;
        }
        setSaving(false);
      }
    }
    const setLoading = kind === "siliconflow" ? setSfLoading : kind === "deepseek" ? setDsLoading : setDoubaoLoading;
    const setModels = kind === "siliconflow" ? setSfModels : kind === "deepseek" ? setDsModels : setDoubaoModels;
    setLoading(true);
    try {
      const r = await meta.api();
      // 已选模型不在新列表时保留在 options 中（防止拉取后已选模型从下拉消失/显示异常）
      const current = v[`llm.${kind}.model`];
      if (current && !r.models.some((m) => m.id === current)) {
        r.models.unshift({ id: current, owned_by: "" });
      }
      setModels(r.models);
      message.success(`已获取 ${r.models.length} 个模型`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "获取模型列表失败");
    } finally {
      setLoading(false);
    }
  }

  async function previewWatermark() {
    const v = form.getFieldsValue();
    setPreviewing(true);
    try {
      const url = await systemApi.previewWatermark({
        template: v["watermark.template"],
        position: v["watermark.position"],
        bg_opaque: v["watermark.bg_opaque"] !== "0",
      });
      setPreviewUrl(url);
      setPreviewOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "预览失败");
    } finally {
      setPreviewing(false);
    }
  }

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "20px 0 4px" }}>
      <span style={{ width: 3, height: 14, background: "#1677ff", borderRadius: 2 }} />
      <Typography.Text strong>{children}</Typography.Text>
    </div>
  );

  const keyField = (k: keyof Settings, label: string, opts?: { secret?: boolean; hint?: string; placeholder?: string }) => (
    <Form.Item
      key={k}
      name={k}
      label={label}
      extra={opts?.hint}
    >
      <Input.Password
        autoComplete="new-password"
        placeholder={opts?.placeholder ?? (opts?.secret ? "填新值覆盖，留空不修改" : "")}
      />
    </Form.Item>
  );

  const baseTab = (
    <>
      <Form.Item name="site.name" label="系统名称">
        <Input placeholder="物料通管理系统" />
      </Form.Item>
      <Form.Item name="session.expire_hours" label="会话有效期（小时）" extra="登录后无操作多久自动失效，1~720 小时">
        <InputNumber style={{ width: 200 }} min={1} max={720} />
      </Form.Item>
      <Form.Item name="bill.rule" label="单据编号规则" extra="格式：前缀列表，用 | 分隔">
        <Input placeholder="RK|LL|DB|PD|QT|QCK" />
      </Form.Item>
      <Form.Item name="watermark.template" label="完成工作照片水印模板" extra="占位符：{location} 使用地点 / {time} 完成时间 / {gps} 定位坐标；下载照片时动态添加，原始照片不保存水印">
        <Input placeholder="地点：{location}｜时间：{time}｜坐标：{gps}" />
      </Form.Item>
      <Form.Item name="watermark.position" label="水印位置">
        <Select
          style={{ width: 240 }}
          options={[
            { value: "bottom", label: "底部居中（默认）" },
            { value: "top", label: "顶部居中" },
            { value: "bottom-left", label: "左下角" },
            { value: "bottom-right", label: "右下角" },
            { value: "top-left", label: "左上角" },
            { value: "top-right", label: "右上角" },
          ]}
        />
      </Form.Item>
      <Form.Item name="watermark.bg_opaque" label="水印背景透明" valuePropName="checked" getValueProps={(v) => ({ checked: v === "0" })} normalize={(v) => (v ? "0" : "1")} extra="开启后不绘制黑色背景条，仅保留白字黑描边（不遮挡照片内容）">
        <Switch />
      </Form.Item>
      <Button loading={previewing} onClick={() => void previewWatermark()} style={{ marginBottom: 8 }}>
        预览水印效果
      </Button>
      <Form.Item name="log.level" label="运行时日志级别" extra="后端日志文件 logs/app-YYYY-MM-DD.log；保存后立即生效（无需重启）">
        <Select
          style={{ width: 240 }}
          options={[
            { value: "DEBUG", label: "DEBUG（最详细，含大模型调用明细）" },
            { value: "INFO", label: "INFO（默认：请求/登录/OCR任务/备份等关键操作）" },
            { value: "WARN", label: "WARN（仅警告与错误）" },
            { value: "ERROR", label: "ERROR（仅错误）" },
          ]}
        />
      </Form.Item>
    </>
  );

  const ocrTab = (
    <>
      <Form.Item
        name="ocr.engine"
        label="本地 OCR 识别引擎"
        extra="商品外包装/标签识别优先使用本地 OCR；选择「关闭」后自动回退使用视觉模型（下方视觉模型需已配置并启用）；若视觉模型也未启用，相关识别功能将提示「不可用」"
      >
        <Radio.Group
          options={[
            { value: "rapidocr", label: "RapidOCR-json（Windows 本地）" },
            { value: "paddle", label: "PP-OCR（PaddleOCR，本地默认引擎，可自动安装）" },
            { value: "off", label: "关闭（商品识别回退视觉模型）" },
          ]}
        />
      </Form.Item>
      <Form.Item name="ocr.model_version" label="PP-OCR 模型版本" tooltip="保存后生效；PP-OCRv6 为最新版本（需 paddleocr 3.4+，首次识别自动下载模型）">
        <Select
          disabled={ocrEngine === "off"}
          options={[
            { value: "PP-OCRv6", label: "PP-OCRv6（推荐）" },
            { value: "PP-OCRv5", label: "PP-OCRv5" },
            { value: "PP-OCRv4", label: "PP-OCRv4" },
          ]}
        />
      </Form.Item>
      <Space orientation="vertical" style={{ marginBottom: 16 }}>
        <Space>
          <span>PP-OCR 运行环境：</span>
          {installState.status === "installing" && <Tag color="processing">安装中…</Tag>}
          {installState.status === "done" && (
            <Tag color="success">已安装（{installState.mode === "gpu" ? "GPU 加速" : "CPU"}）</Tag>
          )}
          {installState.status === "failed" && <Tag color="error">安装失败</Tag>}
          {installState.status === "idle" && <Tag>未安装</Tag>}
          <Button size="small" loading={installState.status === "installing"} onClick={() => void startInstallPaddle()}>
            {installState.status === "done" ? "重新安装（paddlepaddle + paddleocr）" : "自动安装（paddlepaddle + paddleocr）"}
          </Button>
        </Space>
        {installState.status === "done" && (
          <Typography.Text type="success">
            安装完成（{installState.mode === "gpu" ? "GPU 加速" : "CPU 运行"}），请重启后端生效，然后选择 PP-OCR 引擎并保存。
          </Typography.Text>
        )}
        {installState.status === "failed" && installState.log && (
          <Alert type="error" showIcon title="自动安装失败" description={<pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>{installState.log}</pre>} />
        )}
        {installState.status === "installing" && (
          <Spin size="small" description="后台安装中（约 1-5 分钟，视网络）…" />
        )}
      </Space>
      <SectionTitle>豆包（拍照识别物品）</SectionTitle>
      <Form.Item
        name="llm.doubao.enabled"
        label="启用豆包大模型"
        valuePropName="checked"
        getValueProps={(v) => ({ checked: v !== "0" })}
        normalize={(v) => (v ? "1" : "0")}
      >
        <Switch />
      </Form.Item>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
        豆包大模型（拍照识别物品，支持外网/内网 API）；关闭后拍照识别未匹配时不再调用大模型分析，并提示已关闭
      </Typography.Text>
      {keyField("llm.doubao.api_key", "豆包 API Key", { secret: true, placeholder: "填新 Key 覆盖，留空不修改" })}
      <Form.Item name="llm.doubao.base_url" label="豆包 Base URL"><Input placeholder="https://ark.cn-beijing.volces.com/api/v3" /></Form.Item>
      <Form.Item name="llm.doubao.model" label="豆包模型" extra="保存豆包 API Key 后自动获取模型列表，也可点右侧按钮手动刷新">
        <Space.Compact style={{ width: "100%" }}>
          <Select
            style={{ flex: 1 }}
            showSearch
            allowClear
            value={doubaoModel}
            onChange={(v) => form.setFieldValue("llm.doubao.model", v)}
            placeholder="如：doubao-1-5-vision-pro-32k-250115"
            options={doubaoModels.map((m) => ({ value: m.id, label: m.owned_by ? `${m.id}（${m.owned_by}）` : m.id }))}
            optionFilterProp="label"
          />
          <Button loading={doubaoLoading} onClick={() => void fetchModelList("doubao")}>获取模型列表</Button>
        </Space.Compact>
      </Form.Item>
      <SectionTitle>文本模型（文字结构化 / 材料分类）</SectionTitle>
      <Form.Item
        name="llm.deepseek.enabled"
        label="启用文本模型"
        valuePropName="checked"
        getValueProps={(v) => ({ checked: v !== "0" })}
        normalize={(v) => (v ? "1" : "0")}
      >
        <Switch />
      </Form.Item>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
        对视觉模型识别结果做材料分类（自动分类入库）；未配置时跳过分类
      </Typography.Text>
      {keyField("llm.deepseek.api_key", "文本模型 API Key", { secret: true, placeholder: "填新 Key 覆盖，留空不修改" })}
      <Form.Item name="llm.deepseek.base_url" label="文本模型 Base URL"><Input placeholder="https://api.deepseek.com/v1" /></Form.Item>
      <Form.Item name="llm.deepseek.model" label="文本模型名称" extra="保存文本模型 API Key 后自动获取模型列表，也可点右侧按钮手动刷新">
        <Space.Compact style={{ width: "100%" }}>
          <Select
            style={{ flex: 1 }}
            showSearch
            allowClear
            value={dsModel}
            onChange={(v) => form.setFieldValue("llm.deepseek.model", v)}
            placeholder="如：deepseek-chat"
            options={dsModels.map((m) => ({ value: m.id, label: m.owned_by ? `${m.id}（${m.owned_by}）` : m.id }))}
            optionFilterProp="label"
          />
          <Button loading={dsLoading} onClick={() => void fetchModelList("deepseek")}>获取模型列表</Button>
        </Space.Compact>
      </Form.Item>
      <SectionTitle>视觉模型（送货单识别，必需）</SectionTitle>
      <Form.Item
        name="llm.siliconflow.enabled"
        label="启用视觉模型"
        valuePropName="checked"
        getValueProps={(v) => ({ checked: v !== "0" })}
        normalize={(v) => (v ? "1" : "0")}
      >
        <Switch />
      </Form.Item>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
        送货单识别统一走视觉模型（已移除本地模板识别）；未配置时识别结果为空，可手动录入
      </Typography.Text>
      {keyField("llm.siliconflow.api_key", "视觉模型 API Key", { secret: true, placeholder: "填新 Key 覆盖，留空不修改" })}
      <Form.Item name="llm.siliconflow.base_url" label="视觉模型 Base URL"><Input placeholder="https://api.siliconflow.cn/v1" /></Form.Item>
      <Form.Item name="llm.siliconflow.model" label="视觉模型名称" extra="保存视觉模型 API Key 后自动获取模型列表，也可点右侧按钮手动刷新">
        <Space.Compact style={{ width: "100%" }}>
          <Select
            style={{ flex: 1 }}
            showSearch
            allowClear
            value={sfModel}
            onChange={(v) => form.setFieldValue("llm.siliconflow.model", v)}
            placeholder="如：nex-agi/Nex-N2-Pro"
            options={sfModels.map((m) => ({ value: m.id, label: m.owned_by ? `${m.id}（${m.owned_by}）` : m.id }))}
            optionFilterProp="label"
          />
          <Button loading={sfLoading} onClick={() => void fetchModelList("siliconflow")}>获取模型列表</Button>
        </Space.Compact>
      </Form.Item>
    </>
  );

  const authTab = (
    <>
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
            { value: "email", label: "邮箱找回（发送重置验证码邮件，需配置邮件服务）" },
            { value: "phone", label: "联系管理员电话找回（展示联系电话）" },
            { value: "both", label: "两者均可（有邮箱优先邮箱）" },
          ]}
        />
      </Form.Item>
      <Form.Item name="site.contact_phone" label="管理员联系电话（电话找回时展示给用户）">
        <Input placeholder="如 13800001111" />
      </Form.Item>
    </>
  );

  const smtpTab = (
    <>
      <Form.Item name="smtp.host" label="服务器地址">
        <Input placeholder="如 smtp.qq.com" />
      </Form.Item>
      <Form.Item name="smtp.port" label="端口">
        <InputNumber style={{ width: 200 }} min={1} max={65535} />
      </Form.Item>
      <Form.Item name="smtp.user" label="账号">
        <Input placeholder="SMTP 账号" />
      </Form.Item>
      {keyField("smtp.password", "密码/授权码", { secret: true, placeholder: "填新值覆盖，留空不修改" })}
      <Form.Item name="smtp.from" label="发件人邮箱（缺省用账号）">
        <Input placeholder="发件邮箱" />
      </Form.Item>
    </>
  );

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "16px 24px 48px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>系统设置</Typography.Title>
          <Typography.Text type="secondary">站点信息 · 识别引擎与大模型 · 账号安全 · 邮件服务</Typography.Text>
        </div>
        <Button type="primary" size="large" loading={saving} onClick={() => void save()}>保存设置</Button>
      </div>
      <Spin spinning={loading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={() => void save()}
          style={{ background: "#fff", borderRadius: 12, padding: "8px 24px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}
        >
          <Tabs
            items={[
              { key: "base", label: "基础设置", children: baseTab, forceRender: true },
              { key: "ocr", label: "OCR 与大模型", children: ocrTab, forceRender: true },
              { key: "auth", label: "账号与安全", children: authTab, forceRender: true },
              { key: "smtp", label: "邮件服务", children: smtpTab, forceRender: true },
            ]}
          />
        </Form>
      </Spin>

      <Modal
        title="水印效果预览（示例照片）"
        open={previewOpen}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
        width={680}
      >
        {previewUrl && <img src={previewUrl} alt="水印预览" style={{ width: "100%", borderRadius: 8 }} />}
        <div style={{ color: "#86909c", fontSize: 12, marginTop: 8 }}>上方为按当前模板与位置生成的示例效果；保存后实际照片下载时按同样规则添加。</div>
      </Modal>
    </div>
  );
}
