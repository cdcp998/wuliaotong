import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

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

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", height: 36, padding: "0 10px", borderRadius: 6, border: "1px solid #d9d9d9", fontSize: 14, boxSizing: "border-box" }}
      />
      {hint && <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<Settings>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setLoading(true);
    systemApi
      .getSettings()
      .then((s) => setForm({ ...EMPTY, ...s }))
      .catch((e) => setMsg(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  function set(key: keyof Settings, v: string) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const body: Partial<Settings> = { ...form };
      // 密钥传掩码/空 = 不修改（后端规则）
      await systemApi.updateSettings(body);
      setMsg("保存成功（密钥字段留空表示不修改）");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>系统设置</h2>
        <button onClick={() => navigate("/dashboard")}>返回</button>
      </div>

      {loading && <p>加载中…</p>}
      {msg && <p style={{ color: msg.includes("成功") ? "#52c41a" : "#ff4d4f" }}>{msg}</p>}

      <div style={{ background: "#fff", padding: 20, borderRadius: 8, marginTop: 16 }}>
        <h3>通用</h3>
        <Field label="系统名称" value={form["site.name"]} onChange={(v) => set("site.name", v)} />
        <Field label="会话有效期（小时）" value={form["session.expire_hours"]} onChange={(v) => set("session.expire_hours", v)} />
      </div>

      <div style={{ background: "#fff", padding: 20, borderRadius: 8, marginTop: 16 }}>
        <h3>OCR 引擎</h3>
        <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
          {[
            { value: "rapidocr", label: "RapidOCR-json（Windows 本地）" },
            { value: "paddle", label: "PaddleOCR（Debian/Linux）" },
          ].map((o) => (
            <label key={o.value} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="ocr-engine"
                checked={form["ocr.engine"] === o.value}
                onChange={() => set("ocr.engine", o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "#999" }}>
          切换引擎只影响识别层（结构化/匹配/大模型链路不变）；PaddleOCR 需在 Linux 部署并安装 paddleocr 后生效。
        </p>
        <Field label="单据编号规则" value={form["bill.rule"]} onChange={(v) => set("bill.rule", v)} hint="格式：前缀列表，用 | 分隔" />
      </div>

      <div style={{ background: "#fff", padding: 20, borderRadius: 8, marginTop: 16 }}>
        <h3>豆包大模型（视觉识别商品，支持外网/内网 API）</h3>
        <Field
          label="API Key"
          type="password"
          value={form["llm.doubao.api_key"]}
          onChange={(v) => set("llm.doubao.api_key", v)}
          placeholder={form["llm.doubao.api_key"] || "填新 Key 覆盖，留空不修改"}
          hint={form["llm.doubao.api_key"] ? `当前已配置（${form["llm.doubao.api_key"]}）` : "未配置"}
        />
        <Field label="Base URL" value={form["llm.doubao.base_url"]} onChange={(v) => set("llm.doubao.base_url", v)} />
        <Field label="模型" value={form["llm.doubao.model"]} onChange={(v) => set("llm.doubao.model", v)} />
      </div>

      <div style={{ background: "#fff", padding: 20, borderRadius: 8, marginTop: 16 }}>
        <h3>DeepSeek（送货单文本结构化）</h3>
        <Field
          label="API Key"
          type="password"
          value={form["llm.deepseek.api_key"]}
          onChange={(v) => set("llm.deepseek.api_key", v)}
          placeholder={form["llm.deepseek.api_key"] || "填新 Key 覆盖，留空不修改"}
          hint={form["llm.deepseek.api_key"] ? `当前已配置（${form["llm.deepseek.api_key"]}）` : "未配置"}
        />
        <Field label="Base URL" value={form["llm.deepseek.base_url"]} onChange={(v) => set("llm.deepseek.base_url", v)} />
        <Field label="模型" value={form["llm.deepseek.model"]} onChange={(v) => set("llm.deepseek.model", v)} />
      </div>

      <div style={{ background: "#fff", padding: 20, borderRadius: 8, marginTop: 16 }}>
        <h3>注册与找回密码</h3>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>注册模式</label>
          {[
            { value: "open", label: "开放注册（注册即开通使用者账号）" },
            { value: "review", label: "审核注册（管理员审核通过后开通）" },
            { value: "closed", label: "关闭注册（仅管理员建号）" },
          ].map((o) => (
            <label key={o.value} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <input type="radio" name="register-mode" checked={form["auth.register_mode"] === o.value} onChange={() => set("auth.register_mode", o.value)} />
              {o.label}
            </label>
          ))}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>忘记密码找回方式</label>
          {[
            { value: "email", label: "邮箱找回（发送重置验证码邮件，需配置下方 SMTP）" },
            { value: "phone", label: "联系管理员电话找回（展示联系电话）" },
            { value: "both", label: "两者均可（有邮箱优先邮箱）" },
          ].map((o) => (
            <label key={o.value} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <input type="radio" name="forgot-method" checked={form["auth.forgot_method"] === o.value} onChange={() => set("auth.forgot_method", o.value)} />
              {o.label}
            </label>
          ))}
        </div>
        <Field label="管理员联系电话（电话找回时展示给用户）" value={form["site.contact_phone"]} onChange={(v) => set("site.contact_phone", v)} />
        <h3 style={{ marginTop: 18 }}>SMTP 邮件服务（邮箱找回用）</h3>
        <Field label="服务器地址（如 smtp.qq.com）" value={form["smtp.host"]} onChange={(v) => set("smtp.host", v)} />
        <Field label="端口（465 SSL / 587 STARTTLS）" value={form["smtp.port"]} onChange={(v) => set("smtp.port", v)} />
        <Field label="账号" value={form["smtp.user"]} onChange={(v) => set("smtp.user", v)} />
        <Field
          label="密码/授权码"
          type="password"
          value={form["smtp.password"]}
          onChange={(v) => set("smtp.password", v)}
          placeholder="填新值覆盖，留空不修改"
          hint={form["smtp.password"] ? `当前已配置（${form["smtp.password"]}）` : "未配置"}
        />
        <Field label="发件人邮箱（缺省用账号）" value={form["smtp.from"]} onChange={(v) => set("smtp.from", v)} />
      </div>

      <div style={{ marginTop: 20 }}>
        <button
          onClick={() => void save()}
          disabled={saving}
          style={{ padding: "10px 40px", borderRadius: 6, border: "none", background: "#1677ff", color: "#fff", fontSize: 15, cursor: "pointer" }}
        >
          {saving ? "保存中…" : "保存设置"}
        </button>
      </div>
    </div>
  );
}
