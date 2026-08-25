import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Alert, Button, Checkbox, Form, Input, Modal } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";

import { authApi, BizError, initApi, otherEndUrl, useAuthStore, type RegisterStatus } from "@wlt/shared";

/** 登录页（设计页 54，电脑端双栏）：左品牌区蓝渐变（一物一码，全程留痕）+ 右白色卡片区。
 *  未初始化跳初始化安装页；已登录直进主页；连续失败 3 次需验证码；忘记密码/注册入口。 */
export function LoginPage() {
  const { message } = App.useApp();
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const navigate = useNavigate();

  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [siteName, setSiteName] = useState("");
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
        if (st.site_name) setSiteName(st.site_name);
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

  /** 输入框统一样式（设计页 54 Box：h42 r12 底 #F6F8FE，前缀图标 15px）。 */
  const boxStyle = { height: 42, borderRadius: 12, background: "#F6F8FE" } as const;
  /** 字段标签（设计页 54：11.5→12px/500 #5B6478）。 */
  const label = (text: string) => <span style={{ fontSize: 12, fontWeight: 500, color: "#5B6478" }}>{text}</span>;

  return (
    <div style={{ minHeight: "100dvh", display: "flex", background: "#F2F5FB" }}>
      {/* 左侧品牌区（设计页 54：135° 蓝渐变 #4F6DF5 → #7C93FF，白字标语 + 装饰圆） */}
      <div
        className="wlt-brand"
        style={{
          flex: 1,
          background: "linear-gradient(135deg, #4F6DF5 0%, #7C93FF 100%)",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "48px 56px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Deco：220×220 半透明白圆（设计页 54 右上装饰） */}
        <div
          style={{
            position: "absolute",
            top: 96,
            right: -56,
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: "rgba(255,255,255,.10)",
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 56 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: "rgba(255,255,255,.2)",
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
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>物料通</div>
            <div style={{ fontSize: 12.5, opacity: 0.75 }}>企业物资管理平台</div>
          </div>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.45, margin: 0 }}>一物一码，全程留痕</h1>
        <p style={{ fontSize: 14, opacity: 0.85, marginTop: 14, lineHeight: 1.9, maxWidth: 480 }}>
          库存 · 领用 · 线缆 · 地图 · 维修 · 知识，一站式物资数字底座
        </p>
      </div>

      {/* 右侧表单区（设计页 54：白底 520 宽 + 白卡 r20 柔投影；窄屏由 mobile.css 堆叠为全宽） */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: 520,
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "48px 56px",
        }}
      >
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 20,
            padding: "32px 36px",
            boxShadow: "0 12px 40px rgba(30,36,51,0.08)",
            border: "1px solid #EFF3FC",
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1E2433", margin: 0 }}>欢迎回来</h2>
          <div style={{ fontSize: 12.5, color: "#5B6478", margin: "6px 0 22px" }}>登录你的物料通账号，继续今天的工作</div>
          <Form layout="vertical" requiredMark={false} onFinish={(v) => void onSubmit(v)}>
            <Form.Item name="username" label={label("登录名")} colon={false} style={{ marginBottom: 16 }} rules={[{ required: true, message: "请输入账号" }]}>
              <Input placeholder="账号 / 用户名" autoFocus prefix={<UserOutlined style={{ color: "#8A93A8", fontSize: 15 }} />} style={boxStyle} />
            </Form.Item>
            <Form.Item name="password" label={label("密码")} colon={false} style={{ marginBottom: 16 }} rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password placeholder="密码" prefix={<LockOutlined style={{ color: "#8A93A8", fontSize: 15 }} />} style={boxStyle} />
            </Form.Item>
            {needCaptcha && (
              <Form.Item name="captcha" label={label("验证码")} colon={false} style={{ marginBottom: 16 }} rules={[{ required: true, message: "请输入验证码" }]}>
                <div style={{ display: "flex", gap: 10 }}>
                  <Input placeholder="4 位验证码" maxLength={4} style={{ ...boxStyle, textTransform: "uppercase", flex: 1 }} />
                  <img
                    src={captchaImg}
                    alt="验证码"
                    title="点击刷新"
                    onClick={() => void refreshCaptcha()}
                    style={{ height: 42, width: 110, borderRadius: 10, cursor: "pointer", border: "1px solid #E4EAF6", background: "#EAEFFF" }}
                  />
                </div>
              </Form.Item>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 18px" }}>
              <Checkbox style={{ fontSize: 12, color: "#5B6478" }} defaultChecked>
                记住我
              </Checkbox>
              <a
                onClick={() => {
                  setForgotOpen(true);
                  setForgotStep("ask");
                  setForgotInfo(null);
                }}
                style={{ fontSize: 12, fontWeight: 500 }}
              >
                忘记密码？
              </a>
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={loading} style={{ height: 46, fontSize: 14, fontWeight: 700, borderRadius: 12 }}>
              登 录
            </Button>
          </Form>
          <div style={{ marginTop: 16, textAlign: "center", fontSize: 11, color: "#8A93A8" }}>
            {regStatus && regStatus.mode !== "closed" && (
              <>
                <a onClick={() => setRegisterOpen(true)} style={{ color: "#8A93A8", textDecoration: "underline", textDecorationStyle: "dotted" }}>
                  注册账号{regStatus.mode === "review" ? "（需管理员审核）" : "（开放注册）"}
                </a>
                {" · "}
              </>
            )}
            <a href={otherEndUrl("mobile")} style={{ color: "#8A93A8", textDecoration: "underline", textDecorationStyle: "dotted" }} title="手机版入口">
              电脑版/手机版互通
            </a>
          </div>
        </div>
        {/* 归属行（设计页 54 右下角元信息） */}
        <div style={{ marginTop: 18, textAlign: "center", fontSize: 11, color: "#8A93A8" }}>
          {siteName ? `${siteName} · ` : ""}v{__APP_VERSION__}
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
                管理员联系电话：<b style={{ color: "#5B7FFF" }}>{forgotInfo.contact_phone}</b>
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
          <p style={{ color: "#5B6478", fontSize: 12 }}>
            {regStatus?.mode === "review" ? "审核注册模式：提交后需管理员审核通过方可登录。" : "开放注册模式：注册即开通使用者账号。"}
          </p>
        </Form>
      </Modal>
    </div>
  );
}
