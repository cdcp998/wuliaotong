import { useEffect, useRef, useState } from "react";
import {
  App,
  Alert,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tabs,
  Typography,
  theme,
  type TableProps,
} from "antd";
import {
  AlertOutlined,
  ApartmentOutlined,
  EyeOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  GlobalOutlined,
  HddOutlined,
  KeyOutlined,
  MailOutlined,
  MessageOutlined,
  PictureOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UserAddOutlined,
} from "@ant-design/icons";

import {
  storageApi,
  systemApi,
  type ModelSceneInfo,
  type OcrInstallState,
  type QuotaPayload,
  type Settings,
  type StorageHealth,
  type StorageItem,
  type StoragePayload,
} from "@wlt/shared";

const EMPTY: Settings = {
  "site.name": "",
  "session.expire_hours": "8",
  "ocr.engine": "paddle",
  "ocr.model_version": "PP-OCRv6",
  "llm.mm_llm.enabled": "1",
  // 模型承担任务开关默认全开（主用/备用）
  "llm.mm_llm.scene.match_vision": "1",
  "llm.mm_llm.scene.vision_product": "1",
  "llm.mm_llm.scene.classify_items": "1",
  "llm.mm_llm.scene.ocr_correct": "1",
  "llm.mm_llm.scene.vision_text": "1",
  "llm.mm_llm.scene.structured": "1",
  "llm.siliconflow.scene.vision_delivery": "1",
  "llm.siliconflow.scene.vision_product": "1",
  "llm.siliconflow.scene.vision_text": "1",
  "llm.siliconflow.scene.match_vision": "1",
  "llm.deepseek.scene.ocr_correct": "1",
  "llm.deepseek.scene.classify_items": "1",
  "llm.deepseek.scene.structured": "1",
  "llm.deepseek.enabled": "1",
  "watermark.template": "",
  "watermark.position": "bottom",
  "watermark.bg_opaque": "1",
  "log.level": "INFO",
  "quota.warning.enabled": "0",
  "quota.warning.recipients": "",
  "quota.refresh.interval_minutes": "60",
  "quota.warning.threshold.siliconflow": "50",
  "quota.warning.threshold.deepseek": "50",
  "quota.warning.threshold.mm_llm": "50",
  "llm.mm_llm.api_key": "",
  "llm.mm_llm.base_url": "",
  "llm.mm_llm.model": "",
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

/** 存储位置表单值（Switch 用 boolean，提交时转 0/1）。 */
interface StorageFormValues {
  name: string;
  path: string;
  policy: "fill" | "round" | "manual";
  is_default: boolean;
  status: boolean;
  remark?: string;
}

/** 存储选择策略文案（fill 最空闲 / round 轮询 / manual 手动指定）。 */
const STORAGE_POLICY_META: Record<"fill" | "round" | "manual", { label: string; color: string }> = {
  fill: { label: "最空闲", color: "green" },
  round: { label: "轮询", color: "blue" },
  manual: { label: "手动指定", color: "orange" },
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

/** 系统设置（电脑端）：按功能分类平铺（Tabs）的表单页，符合《UI设计方案.md》§4.11 分 Tab 表单约定。 */
export function SettingsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [form] = Form.useForm<Settings>();
  const ocrEngine = Form.useWatch("ocr.engine", form);
  // 模型字段在 Space.Compact 内，antd v6 Form.Item 只注入 value/onChange 给直接子元素（Space.Compact 不透传），
  // Select 拿不到表单绑定会变成非受控（选中不写 store、回显失效）→ 显式受控绑定 form
  const mmLlmModel = Form.useWatch("llm.mm_llm.model", form);
  const dsModel = Form.useWatch("llm.deepseek.model", form);
  const sfModel = Form.useWatch("llm.siliconflow.model", form);
  // 配额区块展示各服务商启用状态（随开关变化响应式刷新）
  const sfEnabled = Form.useWatch("llm.siliconflow.enabled", form);
  const dsEnabled = Form.useWatch("llm.deepseek.enabled", form);
  const mmLlmEnabled = Form.useWatch("llm.mm_llm.enabled", form);
  // 邮件服务分区：根据已填 SMTP 服务器地址显示配置状态（随输入实时刷新）
  const smtpHost = Form.useWatch("smtp.host", form);
  // 配额与预警分区状态（随开关变化响应式刷新）
  const quotaEnabled = Form.useWatch("quota.warning.enabled", form);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 未保存修改标记（对比 toStrings 后的快照，规避 number/string/null 差异）
  const [dirty, setDirty] = useState(false);
  const loadedRef = useRef("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);
  // SiliconFlow 模型列表（保存 API Key 后拉取，供选择模型）
  const [sfModels, setSfModels] = useState<{ id: string; owned_by: string }[]>([]);
  const [sfLoading, setSfLoading] = useState(false);
  // DeepSeek（文本模型）模型列表
  const [dsModels, setDsModels] = useState<{ id: string; owned_by: string }[]>([]);
  const [dsLoading, setDsLoading] = useState(false);
  // 多模态大模型（MM-LLM）模型列表
  const [mmLlmModels, setMmLlmModels] = useState<{ id: string; owned_by: string }[]>([]);
  const [mmLlmLoading, setMmLlmLoading] = useState(false);
  // PP-OCR 自动安装状态（后台线程安装，前端轮询）
  const [installState, setInstallState] = useState<OcrInstallState>({ status: "idle", log: "" });
  const installTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // 配额快照（最近一次获取结果，含失败信息）与模型-任务映射
  const [quota, setQuota] = useState<Record<string, QuotaPayload>>({});
  const [quotaLoading, setQuotaLoading] = useState<Record<string, boolean>>({});
  const [scenes, setScenes] = useState<ModelSceneInfo[]>([]);
  // 图片池与存储：多存储地址列表 / 健康检测结果 / 新增编辑弹窗
  const [storages, setStorages] = useState<StorageItem[]>([]);
  const [healthMap, setHealthMap] = useState<Record<number, StorageHealth>>({});
  const [healthLoading, setHealthLoading] = useState(false);
  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [editingStorage, setEditingStorage] = useState<StorageItem | null>(null);
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageForm] = Form.useForm<StorageFormValues>();

  useEffect(() => {
    systemApi.getQuota().then((r) => setQuota(r.providers)).catch(() => undefined);
    systemApi.getModelScenes().then((r) => setScenes(r.models)).catch(() => undefined);
  }, []);

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
        loadedRef.current = JSON.stringify(toStrings(merged));
        setDirty(false);
      })
      .catch((e) => message.error(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [form, message]);

  // 多存储地址列表（图片池与存储分区）
  useEffect(() => {
    void loadStorages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 任意字段变化后与已加载快照比对，驱动「未保存」提示（setFieldsValue 不触发本回调）。 */
  function handleValuesChange() {
    setDirty(JSON.stringify(toStrings(form.getFieldsValue())) !== loadedRef.current);
  }

  async function save() {
    const values = form.getFieldsValue();
    setSaving(true);
    try {
      await systemApi.updateSettings(toStrings(values));
      message.success("保存成功（密钥字段留空表示不修改）");
      // 注意：保存后不再自动获取模型列表——拉取会用已保存 Key 替换下拉 options，
      // 已选模型不在新列表时会被清空显示（用户反馈 BUG）。模型列表仅在点「获取模型列表」按钮时拉取。
      loadedRef.current = JSON.stringify(toStrings(values));
      setDirty(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  /** ---- 图片池与存储：多存储地址管理（《后端API设计.md》§7，权限 sys:config）---- */
  async function loadStorages() {
    try {
      setStorages(await storageApi.list());
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载存储位置失败");
    }
  }

  async function checkStorageHealth() {
    setHealthLoading(true);
    try {
      const rows = await storageApi.health();
      setHealthMap(Object.fromEntries(rows.map((h) => [h.id, h])));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "健康检测失败");
    } finally {
      setHealthLoading(false);
    }
  }

  function openStorageModal(item?: StorageItem) {
    setEditingStorage(item ?? null);
    storageForm.setFieldsValue(
      item
        ? { name: item.name, path: item.path, policy: item.policy, is_default: item.is_default === 1, status: item.status === 1, remark: item.remark }
        : { name: "", path: "", policy: "fill", is_default: false, status: true, remark: "" }
    );
    setStorageModalOpen(true);
  }

  async function submitStorage() {
    const v = await storageForm.validateFields();
    const payload: StoragePayload = {
      name: v.name.trim(),
      path: v.path.trim(),
      policy: v.policy,
      is_default: v.is_default ? 1 : 0,
      status: v.status ? 1 : 0,
      remark: v.remark?.trim() ?? "",
    };
    setStorageSaving(true);
    try {
      if (editingStorage) {
        await storageApi.update(editingStorage.id, payload);
        message.success("存储位置已更新");
      } else {
        await storageApi.create(payload);
        message.success("存储位置已新增");
      }
      setStorageModalOpen(false);
      await loadStorages();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setStorageSaving(false);
    }
  }

  async function removeStorage(item: StorageItem) {
    try {
      await storageApi.remove(item.id);
      message.success("存储位置已删除");
      await loadStorages();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function setDefaultStorage(item: StorageItem) {
    try {
      await storageApi.update(item.id, {
        name: item.name,
        path: item.path,
        policy: item.policy,
        is_default: 1,
        status: item.status,
        remark: item.remark,
      });
      message.success("已设为默认存储");
      await loadStorages();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  type LlmKind = "siliconflow" | "deepseek" | "mm_llm";

  const LLM_META: Record<LlmKind, { label: string; enableLabel: string; api: () => Promise<{ models: { id: string; owned_by: string }[] }> }> = {
    siliconflow: { label: "视觉模型", enableLabel: "启用视觉模型", api: systemApi.listSiliconflowModels },
    deepseek: { label: "文本模型", enableLabel: "启用文本模型", api: systemApi.listDeepseekModels },
    mm_llm: { label: "多模态大模型 (MM-LLM)", enableLabel: "启用多模态大模型", api: systemApi.listMmLlmModels },
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
          loadedRef.current = JSON.stringify(toStrings(v));
          setDirty(false);
          message.success("设置已保存，正在获取模型列表…");
        } catch (e) {
          message.error(e instanceof Error ? e.message : "保存失败");
          setSaving(false);
          return;
        }
        setSaving(false);
      }
    }
    const setLoading = kind === "siliconflow" ? setSfLoading : kind === "deepseek" ? setDsLoading : setMmLlmLoading;
    const setModels = kind === "siliconflow" ? setSfModels : kind === "deepseek" ? setDsModels : setMmLlmModels;
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

  const QUOTA_META: Record<string, { label: string; enabledKey: keyof Settings; unitHint: string }> = {
    siliconflow: { label: "视觉模型", enabledKey: "llm.siliconflow.enabled", unitHint: "元" },
    deepseek: { label: "文本模型", enabledKey: "llm.deepseek.enabled", unitHint: "元" },
    mm_llm: { label: "多模态大模型 (MM-LLM)", enabledKey: "llm.mm_llm.enabled", unitHint: "与服务商返回数值同单位" },
  };

  /** 立即从服务商获取配额/余额；未启用或未配置 API Key 时不查询（直接提示），
   *  其余失败由后端返回 ok=false + error，界面内联展示（优雅降级）。 */
  async function refreshQuota(provider: string) {
    const meta = QUOTA_META[provider];
    const v = form.getFieldsValue();
    if (v[meta.enabledKey] === "0") {
      message.warning(`${meta.label} 未启用：无需获取配额（请先打开启用开关并保存）`);
      return;
    }
    if (!v[`llm.${provider}.api_key` as keyof Settings]) {
      message.warning(`未填写${meta.label} API Key：请先填写并保存，再获取配额`);
      return;
    }
    setQuotaLoading((m) => ({ ...m, [provider]: true }));
    try {
      const r = await systemApi.fetchQuota(provider);
      setQuota((m) => ({ ...m, [provider]: r }));
      if (r.ok) {
        message.success(`${QUOTA_META[provider].label} 配额获取成功`);
      } else {
        message.warning(`${QUOTA_META[provider].label} 配额获取失败：${r.error ?? "未知错误"}`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "获取配额失败");
    } finally {
      setQuotaLoading((m) => ({ ...m, [provider]: false }));
    }
  }

  /** 配额区块：每个服务商一行（配额展示 + 获取按钮 + 告警阈值）。 */
  const providerEnabled: Record<string, string | undefined> = {
    siliconflow: sfEnabled,
    deepseek: dsEnabled,
    mm_llm: mmLlmEnabled,
  };
  const quotaBlock = (
    <Space orientation="vertical" style={{ width: "100%" }} size={4}>
      {(["siliconflow", "deepseek", "mm_llm"] as const).map((p) => {
        const meta = QUOTA_META[p];
        const snap = quota[p];
        const enabled = providerEnabled[p];
        return (
          <div key={p} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Typography.Text strong>{meta.label}</Typography.Text>
              {enabled === "0" ? <Tag>未启用</Tag> : <Tag color="green">已启用</Tag>}
              <Button size="small" loading={quotaLoading[p]} onClick={() => void refreshQuota(p)}>获取配额</Button>
              <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
                告警阈值（低于该值时邮件通知，单位：{meta.unitHint}）
              </span>
              <Form.Item
                name={`quota.warning.threshold.${p}`}
                style={{ marginBottom: 0 }}
                normalize={(v) => (v === null || v === undefined ? "" : String(v))}
              >
                <InputNumber style={{ width: 110 }} min={0} step={10} />
              </Form.Item>
            </div>
            {snap ? (
              snap.ok ? (
                <div style={{ marginTop: 6 }}>
                  {snap.items?.map((it) => (
                    <span key={it.name} style={{ marginRight: 16, fontSize: 12 }}>
                      <Typography.Text type="secondary">{it.name}：</Typography.Text>
                      <Typography.Text strong style={{ color: (it.remaining ?? 0) >= 0 ? undefined : undefined }}>
                        {it.value !== null ? `${it.value} ${it.unit}` : "—"}
                      </Typography.Text>
                      {it.status ? <Tag style={{ marginLeft: 6 }}>{it.status}</Tag> : null}
                    </span>
                  ))}
                  <span style={{ fontSize: 12, color: token.colorTextTertiary }}>获取时间：{snap.fetched_at}</span>
                </div>
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 6 }}
                  title={`获取失败（${snap.fetched_at}）：${snap.error ?? "未知错误"}。请检查 API Key / 网络后重试。`}
                />
              )
            ) : (
              <Typography.Text type="secondary" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
                尚未获取过配额，点击「获取配额」从服务商拉取余额/用量。
              </Typography.Text>
            )}
          </div>
        );
      })}
    </Space>
  );

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

  /** 基础设置分区：浅色圆角区块（图标 + 标题 + 描述 + 右侧附加信息），
   *  邮件服务等子项以分区形式呈现（《前端设计.md》系统设置页）。 */
  const Section = ({
    icon,
    title,
    desc,
    extra,
    children,
  }: {
    icon: React.ReactNode;
    title: string;
    desc?: string;
    extra?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <section
      style={{
        background: token.colorBgLayout,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        padding: "18px 20px 6px",
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: token.colorPrimaryBg,
            color: token.colorPrimary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Typography.Text strong style={{ fontSize: 14 }}>{title}</Typography.Text>
            {extra}
          </div>
          {desc && (
            <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
              {desc}
            </Typography.Text>
          )}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
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
        style={{ maxWidth: 560 }}
        placeholder={opts?.placeholder ?? (opts?.secret ? "填新值覆盖，留空不修改" : "")}
      />
    </Form.Item>
  );

  /** 存储地址表格列：策略/状态/默认/健康/文件数与操作（设默认、编辑、删除）。 */
  const storageColumns: NonNullable<TableProps<StorageItem>["columns"]> = [
    { title: "名称", dataIndex: "name", width: 130, ellipsis: true },
    { title: "路径", dataIndex: "path", ellipsis: true },
    {
      title: "策略",
      dataIndex: "policy",
      width: 90,
      render: (v: StorageItem["policy"]) => (
        <Tag color={STORAGE_POLICY_META[v]?.color}>{STORAGE_POLICY_META[v]?.label ?? v}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 70,
      render: (v: number) => (v === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: "默认",
      dataIndex: "is_default",
      width: 70,
      render: (v: number) => (v === 1 ? <Tag color="gold">默认</Tag> : "-"),
    },
    {
      title: "健康",
      key: "health",
      width: 150,
      render: (_, r: StorageItem) => {
        const h = healthMap[r.id];
        if (!h) return <Typography.Text type="secondary">未检测</Typography.Text>;
        if (!h.exists) return <Tag color="red">路径不存在</Tag>;
        if (!h.writable) return <Tag color="orange">不可写</Tag>;
        return <Tag color="green">正常 · 剩 {h.free_gb}G</Tag>;
      },
    },
    { title: "已存文件", dataIndex: "file_count", width: 80 },
    {
      title: "操作",
      key: "op",
      width: 160,
      render: (_, r: StorageItem) => (
        <Space size={4}>
          {r.is_default !== 1 && (
            <Button type="link" size="small" onClick={() => void setDefaultStorage(r)}>
              设默认
            </Button>
          )}
          <Button type="link" size="small" onClick={() => openStorageModal(r)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该存储位置？"
            description="已有文件的存储禁止删除（可改为停用）"
            onConfirm={() => void removeStorage(r)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const baseTab = (
    <>
      <Section
        icon={<GlobalOutlined />}
        title="站点信息"
        desc="系统名称、会话有效期与单据编号规则等基础参数。"
      >
        <Form.Item name="site.name" label="系统名称">
          <Input style={{ maxWidth: 560 }} placeholder="物料通管理系统" />
        </Form.Item>
        <Form.Item name="session.expire_hours" label="会话有效期（小时）" extra="登录后无操作多久自动失效，1~720 小时">
          <InputNumber style={{ width: 200 }} min={1} max={720} />
        </Form.Item>
      </Section>

      <Section
        icon={<HddOutlined />}
        title="共用存储池"
        desc="单据/OCR 图片等文件统一存放于共用存储池：可配置多个存储位置（本地目录/盘符），上传时按选择策略（最空闲 / 轮询 / 手动指定）自动落盘。"
        extra={storages.length > 0 ? <Tag color="blue">{storages.length} 个存储</Tag> : undefined}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="存储位置路径支持相对或绝对路径：相对路径以 backend/ 为基准（如 data/files），绝对路径如 D:\image_pool。"
        />
        <Divider style={{ margin: "8px 0 16px" }} />
        <Space style={{ marginBottom: 12 }} wrap>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => openStorageModal()}>
            新增存储位置
          </Button>
          <Button size="small" onClick={() => void checkStorageHealth()} loading={healthLoading}>
            检测存储健康
          </Button>
        </Space>
        <Table<StorageItem>
          rowKey="id"
          size="small"
          columns={storageColumns}
          dataSource={storages}
          pagination={false}
          locale={{ emptyText: "暂无存储位置，点击「新增存储位置」添加（上传文件按策略落盘）" }}
        />
        <Modal
          title={editingStorage ? "编辑存储位置" : "新增存储位置"}
          open={storageModalOpen}
          onOk={() => void submitStorage()}
          confirmLoading={storageSaving}
          onCancel={() => setStorageModalOpen(false)}
          destroyOnClose
        >
          <Form form={storageForm} layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
              <Input maxLength={50} placeholder="如：本机 D 盘图片目录" />
            </Form.Item>
            <Form.Item
              name="path"
              label="路径"
              rules={[{ required: true, message: "请输入路径" }]}
              extra="绝对路径或相对 backend/ 的目录（如 data/files 或 D:\image_pool）"
            >
              <Input maxLength={500} placeholder="如 D:\image_pool 或 data/files" />
            </Form.Item>
            <Form.Item name="policy" label="选择策略" rules={[{ required: true, message: "请选择策略" }]}>
              <Select
                options={[
                  { value: "fill", label: "最空闲（优先剩余空间最大的存储）" },
                  { value: "round", label: "轮询（依次轮流落盘）" },
                  { value: "manual", label: "手动指定" },
                ]}
              />
            </Form.Item>
            <Space size={32}>
              <Form.Item name="is_default" label="设为默认存储" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="status" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Space>
            <Form.Item name="remark" label="备注">
              <Input.TextArea rows={2} maxLength={200} placeholder="可选" />
            </Form.Item>
          </Form>
        </Modal>
      </Section>

      <Section
        icon={<MailOutlined />}
        title="邮件服务（SMTP）"
        desc="用于「邮箱找回密码」发送重置验证码、AI 配额预警邮件通知（见「OCR 与大模型 → 配额与预警」）。"
        extra={smtpHost ? <Tag color="green">已配置</Tag> : <Tag>未配置</Tag>}
      >
        <Form.Item name="smtp.host" label="服务器地址" extra="如 smtp.qq.com（QQ 邮箱需使用授权码）">
          <Input style={{ maxWidth: 560 }} placeholder="如 smtp.qq.com" />
        </Form.Item>
        <Form.Item name="smtp.port" label="端口">
          <InputNumber style={{ width: 200 }} min={1} max={65535} />
        </Form.Item>
        <Form.Item name="smtp.user" label="账号">
          <Input style={{ maxWidth: 560 }} placeholder="SMTP 账号" />
        </Form.Item>
        {keyField("smtp.password", "密码/授权码", { secret: true, placeholder: "填新值覆盖，留空不修改" })}
        <Form.Item name="smtp.from" label="发件人邮箱（缺省用账号）">
          <Input style={{ maxWidth: 560 }} placeholder="发件邮箱" />
        </Form.Item>
      </Section>

      <Section
        icon={<PictureOutlined />}
        title="完成工作照片水印"
        desc="占位符：{location} 使用地点 / {time} 完成时间 / {gps} 定位坐标；下载照片时动态添加，原始照片不保存水印。"
      >
        <Form.Item name="watermark.template" label="水印模板">
          <Input style={{ maxWidth: 560 }} placeholder="地点：{location}｜时间：{time}｜坐标：{gps}" />
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
        <Button icon={<EyeOutlined />} loading={previewing} onClick={() => void previewWatermark()} style={{ marginBottom: 8 }}>
          预览水印效果
        </Button>
      </Section>

      <Section
        icon={<FileTextOutlined />}
        title="运行日志"
        desc="后端日志文件 logs/app-YYYY-MM-DD.log；保存后立即生效（无需重启）。"
      >
        <Form.Item name="log.level" label="运行时日志级别">
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
      </Section>

      <Section
        icon={<UserAddOutlined />}
        title="注册模式"
        desc="控制用户注册入口的开放方式。"
      >
        <Form.Item name="auth.register_mode" label="注册模式">
          <Radio.Group
            options={[
              { value: "open", label: "开放注册（注册即开通使用者账号）" },
              { value: "review", label: "审核注册（管理员审核通过后开通）" },
              { value: "closed", label: "关闭注册（仅管理员建号）" },
            ]}
          />
        </Form.Item>
      </Section>

      <Section
        icon={<KeyOutlined />}
        title="忘记密码找回"
        desc="用户忘记密码时的找回方式；邮箱找回需先在「基础设置 → 邮件服务」分区配置 SMTP。"
      >
        <Form.Item name="auth.forgot_method" label="找回方式">
          <Radio.Group
            options={[
              { value: "email", label: "邮箱找回（发送重置验证码邮件，需配置邮件服务）" },
              { value: "phone", label: "联系管理员电话找回（展示联系电话）" },
              { value: "both", label: "两者均可（有邮箱优先邮箱）" },
            ]}
          />
        </Form.Item>
        <Form.Item name="site.contact_phone" label="管理员联系电话（电话找回时展示给用户）">
          <Input style={{ maxWidth: 560 }} placeholder="如 13800001111" />
        </Form.Item>
      </Section>
    </>
  );

  const ocrTab = (
    <>
      <Section
        icon={<FileSearchOutlined />}
        title="本地 OCR 识别引擎"
        desc="商品外包装/标签识别优先使用本地 OCR；选择「关闭」后自动回退使用视觉模型（需已配置并启用）；若视觉模型也未启用，相关识别功能将提示「不可用」。"
      >
        <Form.Item name="ocr.engine" label="识别引擎">
          <Radio.Group
            options={[
              { value: "rapidocr", label: "RapidOCR-json（Windows 本地）" },
              { value: "paddle", label: "PP-OCR（PaddleOCR，本地默认引擎，可自动安装）" },
              { value: "off", label: "关闭（商品识别回退视觉模型）" },
            ]}
          />
        </Form.Item>
        <Form.Item name="ocr.model_version" label="PP-OCR 模型版本" tooltip="保存后生效；当前仅支持 PP-OCRv6（需 paddleocr 3.4+，首次识别自动下载模型）">
          <Select
            disabled={ocrEngine === "off"}
            style={{ width: 320 }}
            options={[
              { value: "PP-OCRv6", label: "PP-OCRv6" },
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
      </Section>

      <Section
        icon={<ThunderboltOutlined />}
        title="多模态大模型 (MM-LLM)"
        desc="多模态大模型（MM-LLM，支持外网/内网 API）。"
        extra={mmLlmEnabled === "0" ? <Tag>未启用</Tag> : <Tag color="green">已启用</Tag>}
      >
        <Form.Item
          name="llm.mm_llm.enabled"
          label="启用多模态大模型"
          valuePropName="checked"
          getValueProps={(v) => ({ checked: v !== "0" })}
          normalize={(v) => (v ? "1" : "0")}
        >
          <Switch />
        </Form.Item>
        {keyField("llm.mm_llm.api_key", "多模态大模型 API Key", { secret: true, placeholder: "填新 Key 覆盖，留空不修改" })}
        <Form.Item name="llm.mm_llm.base_url" label="多模态大模型 Base URL" extra="支持任意 OpenAI 兼容服务商（含自建内网服务），填其 Base URL 即可（无默认值，必填）">
          <Input style={{ maxWidth: 560 }} placeholder="https://api.example.com/v1" />
        </Form.Item>
        <Form.Item name="llm.mm_llm.model" label="多模态大模型名称" extra="保存多模态大模型 API Key 后点「获取模型列表」拉取模型，也可直接填写">
          <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
            <Select
              style={{ flex: 1 }}
              showSearch
              allowClear
              value={mmLlmModel}
              onChange={(v) => form.setFieldValue("llm.mm_llm.model", v)}
              placeholder="如：qwen-vl-max / glm-4v / gpt-4o"
              options={mmLlmModels.map((m) => ({ value: m.id, label: m.owned_by ? `${m.id}（${m.owned_by}）` : m.id }))}
              optionFilterProp="label"
            />
            <Button loading={mmLlmLoading} onClick={() => void fetchModelList("mm_llm")}>获取模型列表</Button>
          </Space.Compact>
        </Form.Item>
      </Section>

      <Section
        icon={<EyeOutlined />}
        title="视觉模型（视觉识别）"
        desc="识别统一走视觉模型（支持外网/内网 API）。"
        extra={sfEnabled === "0" ? <Tag>未启用</Tag> : <Tag color="green">已启用</Tag>}
      >
        <Form.Item
          name="llm.siliconflow.enabled"
          label="启用视觉模型"
          valuePropName="checked"
          getValueProps={(v) => ({ checked: v !== "0" })}
          normalize={(v) => (v ? "1" : "0")}
        >
          <Switch />
        </Form.Item>
        {keyField("llm.siliconflow.api_key", "视觉模型 API Key", { secret: true, placeholder: "填新 Key 覆盖，留空不修改" })}
        <Form.Item name="llm.siliconflow.base_url" label="视觉模型 Base URL" extra="支持任意 OpenAI 兼容服务商（含自建内网服务），填其 Base URL 即可；不填默认 SiliconFlow">
          <Input style={{ maxWidth: 560 }} placeholder="https://api.siliconflow.cn/v1" />
        </Form.Item>
        <Form.Item name="llm.siliconflow.model" label="视觉模型名称" extra="保存视觉模型 API Key 后自动获取模型列表，也可点右侧按钮手动刷新">
          <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
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
      </Section>

      <Section
        icon={<MessageOutlined />}
        title="文本模型（文字结构化 / 材料分类）"
        desc="对视觉模型识别结果做材料分类（自动分类入库）；未配置时跳过分类。"
        extra={dsEnabled === "0" ? <Tag>未启用</Tag> : <Tag color="green">已启用</Tag>}
      >
        <Form.Item
          name="llm.deepseek.enabled"
          label="启用文本模型"
          valuePropName="checked"
          getValueProps={(v) => ({ checked: v !== "0" })}
          normalize={(v) => (v ? "1" : "0")}
        >
          <Switch />
        </Form.Item>
        {keyField("llm.deepseek.api_key", "文本模型 API Key", { secret: true, placeholder: "填新 Key 覆盖，留空不修改" })}
        <Form.Item name="llm.deepseek.base_url" label="文本模型 Base URL" extra="支持任意 OpenAI 兼容服务商（含自建内网服务），填其 Base URL 即可；不填默认 DeepSeek">
          <Input style={{ maxWidth: 560 }} placeholder="https://api.deepseek.com/v1" />
        </Form.Item>
        <Form.Item name="llm.deepseek.model" label="文本模型名称" extra="保存文本模型 API Key 后自动获取模型列表，也可点右侧按钮手动刷新">
          <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
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
      </Section>

      <Section
        icon={<AlertOutlined />}
        title="配额与预警（云端服务商）"
        desc="自动获取各服务商剩余配额，低于阈值时邮件预警；需先在「基础设置 → 邮件服务」分区配置 SMTP。"
        extra={quotaEnabled === "1" ? <Tag color="green">预警已开启</Tag> : <Tag>预警关闭</Tag>}
      >
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          系统遵循 OpenAI Chat Completions 兼容标准（POST 「Base URL」/chat/completions + Bearer 鉴权），
          上方三个模型槽位可填入任意 OpenAI 兼容服务商（SiliconFlow / DeepSeek / 火山方舟 / 通义 / 智谱 / 自建 vLLM / Ollama / 第三方网关等），
          Base URL、API Key、模型名均可自由指定，不受供应商限制。
          配额查询依赖服务商官方余额接口，仅 SiliconFlow、DeepSeek、火山方舟提供；
          其他兼容服务商可正常用于识别，但无法获取配额（界面会明确提示），也不参与配额告警。
          配额按下方「获取间隔」自动获取（默认 60 分钟，可自定义；即使未启用预警也会更新），
          也可点各服务商「获取配额」立即刷新。剩余配额低于各服务商阈值时向收件人发送邮件；
          阈值可分别设置（见下方各服务商）。
        </Typography.Text>
        <Form.Item
          name="quota.refresh.interval_minutes"
          label="配额自动获取间隔（分钟）"
          extra="定时任务按此间隔自动获取配额并检查预警（1~10080 分钟，即 1 分钟~7 天），默认 60；手动点「获取配额」可随时立即刷新"
        >
          <InputNumber style={{ width: 200 }} min={1} max={10080} />
        </Form.Item>
        <Form.Item
          name="quota.warning.enabled"
          label="启用配额预警邮件"
          valuePropName="checked"
          getValueProps={(v) => ({ checked: v === "1" })}
          normalize={(v) => (v ? "1" : "0")}
        >
          <Switch />
        </Form.Item>
        <Form.Item
          name="quota.warning.recipients"
          label="预警邮件收件人"
          extra="多个邮箱用英文逗号分隔（如 admin@example.com, ops@example.com）"
        >
          <Input style={{ maxWidth: 560 }} placeholder="admin@example.com, ops@example.com" />
        </Form.Item>
        {quotaBlock}
      </Section>

      <Section
        icon={<ApartmentOutlined />}
        title="模型与工作任务"
        desc="各模型参与的业务任务可单独开关（主用 = 优先调用，备用 = 主用不可用时兜底）；关闭后该模型不参与对应任务：主用关闭走备用，备用关闭则无兜底（直接降级）。"
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={6}>
          {scenes.map((m) => (
            <div key={m.name} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12, padding: "8px 12px", background: token.colorBgContainer }}>
              <Space wrap>
                <Typography.Text strong>{m.label}</Typography.Text>
                {m.enabled ? <Tag color="green">已启用</Tag> : <Tag>未启用</Tag>}
                {m.scenes.map((s) => (
                  <Form.Item
                    key={s.scene}
                    name={`llm.${m.name}.scene.${s.scene}`}
                    valuePropName="checked"
                    getValueProps={(v) => ({ checked: v !== "0" })}
                    normalize={(v) => (v ? "1" : "0")}
                    style={{ marginBottom: 0 }}
                    tooltip={`${s.desc}；关闭后该模型不参与此任务（${s.role === "主用" ? "自动走备用模型" : "无备用兜底，直接降级"}）`}
                  >
                    <Space size={6}>
                      <Switch size="small" />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.label}（{s.role}）</Typography.Text>
                    </Space>
                  </Form.Item>
                ))}
              </Space>
            </div>
          ))}
        </Space>
      </Section>
    </>
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>系统设置</h2>
          <p style={{ color: token.colorTextTertiary, fontSize: 12, margin: "4px 0 0" }}>
            站点信息 · 邮件服务 · 水印 · 注册与找回 · 识别引擎与大模型 · 版本 v{__APP_VERSION__}
          </p>
        </div>
        <Space>
          {dirty && <Tag color="processing">有未保存的修改</Tag>}
          <Button type="primary" loading={saving} onClick={() => void save()}>保存设置</Button>
        </Space>
      </div>
      <Spin spinning={loading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={() => void save()}
          onValuesChange={handleValuesChange}
          style={{
            background: token.colorBgContainer,
            border: `1px solid #E4EAF6`,
            borderRadius: 16,
            boxShadow: "0 6px 24px rgba(30,36,51,.06)",
            padding: "8px 24px 16px",
          }}
        >
          <Tabs
            tabPosition="left"
            items={[
              { key: "base", label: "基础设置", children: baseTab, forceRender: true },
              { key: "ocr", label: "OCR 与大模型", children: ocrTab, forceRender: true },
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
        <div style={{ color: token.colorTextTertiary, fontSize: 12, marginTop: 8 }}>上方为按当前模板与位置生成的示例效果；保存后实际照片下载时按同样规则添加。</div>
      </Modal>
    </div>
  );
}
