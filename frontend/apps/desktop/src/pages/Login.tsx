import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Alert, Button, Checkbox, Form, Input, Modal } from "antd";

import { authApi, BizError, initApi, otherEndUrl, useAuthStore, type RegisterStatus } from "@wlt/shared";

/** 登录页（电脑端双栏：品牌区 + 表单区）：未初始化跳初始化安装页；已登录直进主页；连续失败 3 次需验证码；忘记密码/注册入口。 */
export function LoginPage() {
  const { message } = App.useApp();
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const navigate = useNavigate();

  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<"ask" | "reset" | "done">("ask");
  const [forgotInfo, setForgotInfo] = useState<{ method: string; contact_phone?: string; message: string } | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [regStatus, setRegStatus] = useState<RegisterStatus | null>(null);
  const [forgotForm] = Form.useForm();
  const [registerForm] = Form.useForm();

  useEffect(() => {
    let alive = true;
    (async () => {
      // 未初始化 → 初始化安装页（先于登录流程，避免与 fetchMe 跳转竞争）
      try {
        const st = await initApi.status();
        if (!alive) return;
        if (!st.initialized) {
          navigate("/init", { replace: true });
          return;
        }
      } catch {
        /* 状态接口异常不阻塞登录 */
      }
      if (!alive) return;
      fetchMe()
        .then(() => navigate("/app", { replace: true })) // 已登录 → 主页
        .catch(() => undefined);
      authApi.registerStatus().then(setRegStatus).catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [fetchMe, navigate]);

  async function refreshCaptcha() {
    const d = await authApi.captcha();
    setCaptchaId(d.captcha_id);
    setCaptchaImg(`data:image/png;base64,${d.image}`);
  }

  async function onSubmit(values: { username: string; password: string; captcha?: string }) {
    try {
      await login(values.username, values.password, needCaptcha ? captchaId : "", needCaptcha ? (values.captcha ?? "") : "");
      navigate("/app", { replace: true });
    } catch (err) {
      if (err instanceof BizError && err.code === 4007) {
        setNeedCaptcha(true);
        await refreshCaptcha().catch(() => undefined);
        message.warning(err.message);
      } else {
        message.error(err instanceof Error ? err.message : "登录失败");
      }
    }
  }

  async function doForgot() {
    const v = await forgotForm.validateFields();
    try {
      const r = await authApi.forgot(v.username, v.email || undefined);
      setForgotInfo(r);
      setForgotStep(r.method === "phone" ? "done" : "reset");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function doReset() {
    const v = await forgotForm.validateFields();
    try {
      const r = await authApi.forgotReset(v.username, v.code, v.new_password);
      message.success(r.message);
      setForgotOpen(false);
      setForgotStep("ask");
      setForgotInfo(null);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "重置失败");
    }
  }

  async function doRegister() {
    const v = await registerForm.validateFields();
    try {
      const r = await authApi.register({
        username: v.username,
        password: v.password,
        real_name: v.real_name ?? "",
        phone: v.phone ?? "",
        email: v.email ?? "",
      });
      message.success(r.message);
      setRegisterOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "注册失败");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#fff" }}>
      {/* 左侧品牌区 */}
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
        <h1 style={{ fontSize: 30, lineHeight: 1.4, margin: 0 }}>企业内部物料管理<br />入库 · 出库 · 领用</h1>
        <p style={{ fontSize: 14, opacity: 0.78, marginTop: 14, lineHeight: 1.8 }}>
          单据录入效率、库存准确率、多端随时开单 ——<br />
          拍照 + OCR + 大模型辅助录入，仓管员手机即可完成出入库与盘点。
        </p>
      </div>

      {/* 右侧表单区 */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ width: 340 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>登录系统</h2>
          <div style={{ fontSize: 13, color: "#86909c", margin: "6px 0 26px" }}>物料通管理系统 · 企业内部使用</div>
          <Form layout="vertical" onFinish={(v) => void onSubmit(v)}>
            <Form.Item name="username" rules={[{ required: true, message: "请输入账号" }]}>
              <Input placeholder="账号 / 用户名" size="large" autoFocus />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password placeholder="密码" size="large" />
            </Form.Item>
            {needCaptcha && (
              <Form.Item name="captcha" rules={[{ required: true, message: "请输入验证码" }]}>
                <div style={{ display: "flex", gap: 8 }}>
                  <Input placeholder="4 位验证码" size="large" maxLength={4} style={{ textTransform: "uppercase" }} />
                  <img
                    src={captchaImg}
                    alt="验证码"
                    title="点击刷新"
                    onClick={() => void refreshCaptcha()}
                    style={{ height: 40, borderRadius: 6, cursor: "pointer", border: "1px solid #e5e5e5" }}
                  />
                </div>
              </Form.Item>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "2px 0 18px" }}>
              <Checkbox defaultChecked>记住我</Checkbox>
              <span style={{ fontSize: 12.5 }}>
                <a
                  onClick={() => {
                    setForgotOpen(true);
                    setForgotStep("ask");
                    setForgotInfo(null);
                  }}
                  style={{ marginRight: 10 }}
                >
                  忘记密码？
                </a>
                {regStatus && regStatus.mode !== "closed" && (
                  <a onClick={() => setRegisterOpen(true)}>注册账号</a>
                )}
              </span>
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={loading} style={{ height: 40, fontSize: 15 }}>
              登 录
            </Button>
          </Form>
          <div style={{ marginTop: 18, textAlign: "center", fontSize: 12.5, color: "#86909c" }}>
            手机端操作请前往 <a href={otherEndUrl("mobile")} style={{ color: "#1668dc" }}>手机版入口</a>
          </div>
        </div>
      </div>

      {/* 忘记密码 */}
      <Modal
        title={forgotStep === "done" ? "联系管理员" : forgotStep === "reset" ? "重置密码" : "找回密码"}
        open={forgotOpen}
        footer={null}
        onCancel={() => setForgotOpen(false)}
        destroyOnHidden
        afterOpenChange={(o) => { if (o) forgotForm.resetFields(); }}
      >
        {forgotStep === "ask" && (
          <Form form={forgotForm} layout="vertical">
            <Form.Item name="username" label="账号" rules={[{ required: true, message: "请输入账号" }]}>
              <Input placeholder="登录账号" />
            </Form.Item>
            <Form.Item name="email" label="注册邮箱（邮箱找回时需要）">
              <Input placeholder="用于验证邮箱找回身份" />
            </Form.Item>
            <Button type="primary" block onClick={() => void doForgot()}>下一步</Button>
          </Form>
        )}
        {forgotStep === "reset" && forgotInfo && (
          <Form form={forgotForm} layout="vertical">
            <Alert type="info" showIcon title={forgotInfo.message} style={{ marginBottom: 14 }} />
            <Form.Item name="code" label="邮箱验证码" rules={[{ required: true, message: "请输入邮件中的 6 位验证码" }]}>
              <Input placeholder="6 位验证码" maxLength={6} />
            </Form.Item>
            <Form.Item name="new_password" label="新密码" rules={[{ required: true, min: 6, message: "至少 6 位" }]}>
              <Input.Password />
            </Form.Item>
            <Button type="primary" block onClick={() => void doReset()}>重置密码</Button>
          </Form>
        )}
        {forgotStep === "done" && forgotInfo && (
          <div>
            <Alert type="info" showIcon title={forgotInfo.message} style={{ marginBottom: 14 }} />
            {forgotInfo.contact_phone && (
              <p style={{ fontSize: 15, textAlign: "center" }}>
                管理员联系电话：<b style={{ color: "#1668dc" }}>{forgotInfo.contact_phone}</b>
              </p>
            )}
            <Button block onClick={() => setForgotOpen(false)}>知道了</Button>
          </div>
        )}
      </Modal>

      {/* 注册账号 */}
      <Modal
        title="注册账号"
        open={registerOpen}
        onOk={() => void doRegister()}
        onCancel={() => setRegisterOpen(false)}
        destroyOnHidden
        afterOpenChange={(o) => { if (o) registerForm.resetFields(); }}
      >
        <Form form={registerForm} layout="vertical">
          <Form.Item name="username" label="账号" rules={[{ required: true, min: 2, message: "至少 2 个字符" }]}>
            <Input placeholder="字母/数字/下划线" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: "至少 6 位" }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="real_name" label="姓名"><Input /></Form.Item>
          <Form.Item name="phone" label="手机"><Input maxLength={20} /></Form.Item>
          <Form.Item name="email" label="邮箱（找回密码用）"><Input maxLength={100} /></Form.Item>
          <p style={{ color: "#999", fontSize: 12 }}>
            {regStatus?.mode === "review" ? "审核注册模式：提交后需管理员审核通过方可登录。" : "开放注册模式：注册即开通使用者账号。"}
          </p>
        </Form>
      </Modal>
    </div>
  );
}
