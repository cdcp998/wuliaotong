import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Alert, App, Button, Form, Input, Steps } from "antd";

import { initApi, useAuthStore } from "@wlt/shared";

const STEP_TITLES = ["系统信息", "管理员账号", "联系方式"];

interface InitForm {
  site_name: string;
  admin_username: string;
  admin_password: string;
  confirm_password: string;
  contact_phone?: string;
}

/** 初始化安装页（《前端设计.md》§2.2）：系统未初始化时强制展示，三步引导 →
 * POST /init → 自动登录进入主页面；已初始化访问自动跳回登录/主页。 */
export function InitPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const [form] = Form.useForm<InitForm>();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // 已初始化（含已登录会话）访问本页 → 回登录/主页；未初始化则预填系统名称
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await initApi.status();
        if (!alive) return;
        if (st.initialized) {
          fetchMe()
            .then(() => navigate("/app", { replace: true }))
            .catch(() => navigate("/login", { replace: true }));
          return;
        }
        if (st.site_name) form.setFieldsValue({ site_name: st.site_name });
      } catch {
        /* 状态接口异常不阻塞表单填写 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [form, navigate, fetchMe]);

  async function next() {
    try {
      if (step === 0) await form.validateFields(["site_name"]);
      if (step === 1) await form.validateFields(["admin_username", "admin_password", "confirm_password"]);
      setStep(step + 1);
    } catch {
      /* 校验失败：错误提示由 Form.Item 就地展示，不切换步骤（避免 unhandled rejection） */
    }
  }

  async function onSubmit() {
    try {
      await form.validateFields();
    } catch {
      return; // 校验失败：错误提示由 Form.Item 就地展示
    }
    const v = form.getFieldsValue();
    setSubmitting(true);
    try {
      await initApi.submit({
        site_name: v.site_name.trim(),
        admin_username: v.admin_username.trim(),
        admin_password: v.admin_password,
        contact_phone: v.contact_phone?.trim() || undefined,
      });
      message.success("初始化完成，正在进入系统…");
      await login(v.admin_username.trim(), v.admin_password);
      navigate("/app", { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "初始化失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#fff" }}>
      {/* 左侧品牌区（与登录页一致） */}
      <div
        style={{
          flex: "1.15",
          background: "linear-gradient(135deg,#0d2b52 0%,#1668dc 78%,#3c89f0 100%)",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 64px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -140,
            bottom: -140,
            width: 420,
            height: 420,
            borderRadius: "50%",
            border: "60px solid rgba(255,255,255,.06)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: "rgba(255,255,255,.14)",
              border: "1px solid rgba(255,255,255,.22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            物
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>物料通</div>
            <div style={{ fontSize: 11, opacity: 0.75, letterSpacing: 2 }}>MATERIAL FLOW</div>
          </div>
        </div>
        <h1 style={{ fontSize: 30, lineHeight: 1.4, margin: 0 }}>系统初始化安装</h1>
        <p style={{ fontSize: 14, opacity: 0.78, marginTop: 14, lineHeight: 1.8 }}>
          首次启动引导：完成系统名称、管理员账号等必要配置后即可投入使用。<br />
          仅需执行一次，完成后将直接进入主系统。
        </p>
      </div>

      {/* 右侧表单区 */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ width: 420 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>初始化安装</h2>
          <div style={{ fontSize: 13, color: "#86909c", margin: "6px 0 26px" }}>物料通管理系统 · 首次使用引导</div>
          <Steps
            current={step}
            size="small"
            items={STEP_TITLES.map((title) => ({ title }))}
            style={{ marginBottom: 28 }}
          />
          <Form form={form} layout="vertical" initialValues={{ site_name: "物料通管理系统", admin_username: "admin" }}>
            {/* 三步字段常驻挂载（display 切换）：避免 antd v6 卸载字段丢失值导致提交取值 undefined */}
            <div style={{ display: step === 0 ? "block" : "none" }}>
              <Form.Item
                name="site_name"
                label="系统名称"
                rules={[{ required: true, message: "请输入系统名称" }, { max: 50, message: "最多 50 个字符" }]}
              >
                <Input placeholder="如：XX 公司物料管理系统" size="large" autoFocus={step === 0} />
              </Form.Item>
            </div>
            <div style={{ display: step === 1 ? "block" : "none" }}>
              <Form.Item
                name="admin_username"
                label="管理员账号"
                rules={[
                  { required: true, message: "请输入管理员账号" },
                  { min: 2, message: "至少 2 个字符" },
                  { pattern: /^[a-zA-Z0-9_-]+$/, message: "仅支持字母/数字/下划线/中划线" },
                ]}
              >
                <Input placeholder="字母/数字/下划线" size="large" autoFocus={step === 1} />
              </Form.Item>
              <Form.Item
                name="admin_password"
                label="管理员密码"
                rules={[{ required: true, message: "请输入管理员密码" }, { min: 6, message: "至少 6 位" }]}
              >
                <Input.Password placeholder="至少 6 位" size="large" />
              </Form.Item>
              <Form.Item
                name="confirm_password"
                label="确认密码"
                dependencies={["admin_password"]}
                rules={[
                  { required: true, message: "请再次输入密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("admin_password") === value) return Promise.resolve();
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="再次输入管理员密码" size="large" />
              </Form.Item>
            </div>
            <div style={{ display: step === 2 ? "block" : "none" }}>
              <Form.Item name="contact_phone" label="管理员联系电话（可选）" rules={[{ max: 20, message: "最多 20 个字符" }]}>
                <Input placeholder="用于「电话找回密码」时展示" size="large" autoFocus={step === 2} />
              </Form.Item>
              <Alert
                type="info"
                showIcon
                title="提交后将完成初始化，系统即刻可用。管理员账号可在系统设置中随时调整。"
                style={{ marginBottom: 8 }}
              />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              {step > 0 && (
                <Button size="large" style={{ width: 110 }} onClick={() => setStep(step - 1)}>
                  上一步
                </Button>
              )}
              {step < 2 ? (
                <Button type="primary" size="large" block onClick={() => void next()}>
                  下一步
                </Button>
              ) : (
                <Button type="primary" size="large" block loading={submitting} onClick={() => void onSubmit()}>
                  完成初始化并进入系统
                </Button>
              )}
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}
