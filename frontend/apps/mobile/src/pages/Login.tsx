import { useEffect, useState } from "react";
import { Button, Checkbox, Form, Input, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { authApi, BizError, initApi, otherEndInitUrl, otherEndUrl, useAuthStore, type RegisterStatus } from "@wlt/shared";

type Mode = "login" | "forgot" | "reset" | "register";

/** OP 规格（设计页 M20）：渐变 Hero（Logo 行 + 大标语）+ 白卡表单（r20，输入块 h40/r11/#F6F8FE，
 * 登录钮 r12 #5B7FFF，底部 注册/忘记密码 链接行）。业务逻辑不变：未初始化跳电脑端初始化页、
 * 已登录直进主页、失败 3 次需验证码、记住登录状态、忘记密码/注册。 */

const HERO_SUBTITLE: Record<Mode, string> = {
  login: "随身上报 · 移动办公",
  forgot: "找回密码",
  reset: "重置密码",
  register: "注册新账号",
};

/** 输入块容器：h40 / r11 / #F6F8FE（OP「B horizontal 40 r11 bg#F6F8FE p0/12」）。 */
function Field({ children }: { children: React.ReactNode }) {
  return (
    <div className="wlt-login-field" style={{ height: 40, borderRadius: 11, background: "#F6F8FE", display: "flex", alignItems: "center", padding: "0 12px", gap: 8 }}>
      {children}
    </div>
  );
}

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const navigate = useNavigate();
  const [loginForm] = Form.useForm(); // 登录卡：主按钮在 Form 外（OP 布局），经 form.submit() 提交

  const [mode, setMode] = useState<Mode>("login");
  const [remember, setRemember] = useState(true); // 记住登录状态（默认勾选，与电脑端「记住我」一致）
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [forgotInfo, setForgotInfo] = useState<{ method: string; contact_phone?: string; message: string } | null>(null);
  const [regStatus, setRegStatus] = useState<RegisterStatus | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 未初始化 → 整页跳电脑端初始化安装页（先于登录流程，避免与 fetchMe 跳转竞争）
      try {
        const st = await initApi.status();
        if (!alive) return;
        if (!st.initialized) {
          window.location.replace(otherEndInitUrl());
          return;
        }
      } catch {
        /* 状态接口异常不阻塞登录 */
      }
      if (!alive) return;
      fetchMe()
        .then(() => navigate("/", { replace: true })) // 已登录 → 主页
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
      await login(
        values.username,
        values.password,
        needCaptcha ? captchaId : "",
        needCaptcha ? (values.captcha ?? "") : "",
        remember,
      );
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof BizError && err.code === 4007) {
        setNeedCaptcha(true);
        await refreshCaptcha().catch(() => undefined);
        Toast.show(err.message);
      } else {
        Toast.show(err instanceof Error ? err.message : "登录失败");
      }
    }
  }

  async function doForgot(values: { username: string; email?: string }) {
    try {
      const r = await authApi.forgot(values.username, values.email || undefined);
      setForgotInfo(r);
      setMode("reset");
      Toast.show(r.message);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function doReset(values: { username: string; code: string; new_password: string }) {
    try {
      const r = await authApi.forgotReset(values.username, values.code, values.new_password);
      Toast.show(r.message);
      setMode("login");
      setForgotInfo(null);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "重置失败");
    }
  }

  async function doRegister(values: { username: string; password: string; real_name?: string; phone?: string; email?: string }) {
    try {
      const r = await authApi.register(values);
      Toast.show(r.message);
      setMode("login");
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "注册失败");
    }
  }

  const cardTitle = mode === "login" ? "登录" : mode === "forgot" ? "找回密码" : mode === "reset" ? "重置密码" : "注册账号";

  return (
    <div className="wlt-login" style={{ minHeight: "100dvh", background: "#F2F5FB", display: "flex", flexDirection: "column" }}>
      {/* 渐变 Hero 头部（OP：280 高，135deg #5B7FFF→#7C93FF；Logo 行 + 大标语） */}
      <div
        style={{
          background: "linear-gradient(135deg,#5B7FFF 0%,#7C93FF 100%)",
          padding: "34px 24px 26px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 13,
              background: "rgba(255,255,255,0.2)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 19,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            物
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1.25 }}>物料通</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", lineHeight: 1.4 }}>企业物资管理平台</div>
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>
          {mode === "reset" && forgotInfo?.message ? HERO_SUBTITLE.reset : HERO_SUBTITLE[mode]}
        </div>
      </div>

      {/* 表单卡（OP Card r20 白卡 p22/24 gap12，上叠 Hero 12px） */}
      <div style={{ padding: "12px 16px 24px", flex: 1 }}>
        <div className="wlt-glass-card" style={{ borderRadius: 20, padding: "22px 24px" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#1E2433", marginBottom: 12 }}>{cardTitle}</div>

          {mode === "login" && (
            <>
              <Form className="wlt-login-form" form={loginForm} layout="vertical" onFinish={(v) => void onSubmit(v as { username: string; password: string; captcha?: string })}>
                <Form.Item name="username" label="登录名" rules={[{ required: true, message: "请输入账号" }]}>
                  <Field>
                    {/* 用户图标（14×14 stroke #8A93A8） */}
                    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#8A93A8" strokeWidth={2} strokeLinecap="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
                    </svg>
                    <Input placeholder="账号 / 用户名" clearable style={{ flex: 1 }} autoFocus />
                  </Field>
                </Form.Item>
                <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                  <Field>
                    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#8A93A8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="10" width="16" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                    <Input type="password" placeholder="密码" clearable style={{ flex: 1 }} />
                  </Field>
                </Form.Item>
                {needCaptcha && (
                  <Form.Item name="captcha" label="验证码" rules={[{ required: true, message: "请输入验证码" }]}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Field>
                        <Input placeholder="4 位验证码" maxLength={4} style={{ flex: 1, textTransform: "uppercase" }} />
                      </Field>
                      <img
                        src={captchaImg}
                        alt="验证码"
                        title="点击刷新"
                        onClick={() => void refreshCaptcha()}
                        style={{ height: 40, width: 108, objectFit: "cover", borderRadius: 11, cursor: "pointer", flexShrink: 0 }}
                      />
                    </div>
                  </Form.Item>
                )}
              </Form>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 14px" }}>
                <Checkbox checked={remember} onChange={(v) => setRemember(v)} style={{ "--icon-size": "16px", fontSize: 11.5, color: "#5B6478", "--gap": "6px" } as React.CSSProperties}>
                  记住登录状态
                </Checkbox>
                <a onClick={() => setMode("forgot")} style={{ fontSize: 11.5, color: "#5B7FFF" }}>
                  忘记密码
                </a>
              </div>
              <Button block color="primary" loading={loading} onClick={() => loginForm.submit()} style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}>
                登 录
              </Button>
              {regStatus && regStatus.mode !== "closed" && (
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <a onClick={() => setMode("register")} style={{ fontSize: 11, color: "#5B7FFF" }}>
                    注册账号（需管理员审核）
                  </a>
                </div>
              )}
            </>
          )}

          {mode === "forgot" && (
            <Form
              className="wlt-login-form"
              layout="vertical"
              onFinish={(v) => void doForgot(v as { username: string; email?: string })}
              footer={
                <Button block type="submit" color="primary" size="large" style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}>
                  发送验证码 / 查看联系方式
                </Button>
              }
            >
              <Form.Item name="username" label="登录名" rules={[{ required: true, message: "请输入账号" }]}>
                <Field><Input placeholder="登录账号" clearable style={{ flex: 1 }} /></Field>
              </Form.Item>
              <Form.Item name="email" label="注册邮箱（邮箱找回时填写）">
                <Field><Input placeholder="邮箱" clearable style={{ flex: 1 }} /></Field>
              </Form.Item>
            </Form>
          )}

          {mode === "reset" && (
            <Form
              className="wlt-login-form"
              layout="vertical"
              onFinish={(v) => void doReset(v as { username: string; code: string; new_password: string })}
              footer={
                <Button block type="submit" color="primary" size="large" style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}>
                  重置密码
                </Button>
              }
            >
              {forgotInfo?.method === "phone" && forgotInfo.contact_phone && (
                <div style={{ fontSize: 13, color: "#3B5BDB", marginBottom: 10 }}>
                  管理员联系电话：{forgotInfo.contact_phone}
                </div>
              )}
              <Form.Item name="username" label="登录名" rules={[{ required: true, message: "请输入账号" }]}>
                <Field><Input placeholder="登录账号" clearable style={{ flex: 1 }} /></Field>
              </Form.Item>
              <Form.Item name="code" label="邮箱验证码" rules={[{ required: true, message: "请输入验证码" }]}>
                <Field><Input placeholder="邮箱中的 6 位验证码" maxLength={6} clearable style={{ flex: 1 }} /></Field>
              </Form.Item>
              <Form.Item name="new_password" label="新密码" rules={[{ required: true, min: 6, message: "至少 6 位" }]}>
                <Field><Input type="password" placeholder="至少 6 位" clearable style={{ flex: 1 }} /></Field>
              </Form.Item>
            </Form>
          )}

          {mode === "register" && (
            <Form
              className="wlt-login-form"
              layout="vertical"
              onFinish={(v) => void doRegister(v as { username: string; password: string; real_name?: string; phone?: string; email?: string })}
              footer={
                <Button block type="submit" color="primary" size="large" style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}>
                  注 册
                </Button>
              }
            >
              <Form.Item name="username" label="登录名" rules={[{ required: true, min: 2, message: "至少 2 个字符" }]}>
                <Field><Input placeholder="字母 / 数字 / 下划线" clearable style={{ flex: 1 }} /></Field>
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: "至少 6 位" }]}>
                <Field><Input type="password" placeholder="至少 6 位" clearable style={{ flex: 1 }} /></Field>
              </Form.Item>
              <Form.Item name="real_name" label="姓名（可选）"><Field><Input placeholder="真实姓名" clearable style={{ flex: 1 }} /></Field></Form.Item>
              <Form.Item name="phone" label="手机（可选）"><Field><Input placeholder="手机号" clearable style={{ flex: 1 }} /></Field></Form.Item>
              <Form.Item name="email" label="邮箱（可选，找回密码用）"><Field><Input placeholder="邮箱" clearable style={{ flex: 1 }} /></Field></Form.Item>
              <div style={{ fontSize: 11, color: "#8A93A8", margin: "-4px 0 10px", lineHeight: 1.6 }}>
                {regStatus?.mode === "review" ? "审核注册模式：提交后需管理员审核通过方可登录。" : "开放注册模式：注册即开通使用者账号。"}
              </div>
            </Form>
          )}

          {mode !== "login" && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              {/* 放在 Form 外，避免被渲染进列表导致左对齐错位；内边距保证触屏目标 ≥44px */}
              <a onClick={() => setMode("login")} style={{ display: "inline-block", padding: "12px 24px", fontSize: 12.5, color: "#5B6478" }}>
                返回登录
              </a>
            </div>
          )}
        </div>

        {mode === "login" && (
          <div style={{ textAlign: "center", fontSize: 12, color: "#5B6478", marginTop: 18 }}>
            大屏操作请前往 <a href={otherEndUrl("desktop")} style={{ color: "#3B5BDB" }}>电脑版入口</a>
          </div>
        )}

        <div style={{ textAlign: "center", fontSize: 10.5, color: "#8A93A8", marginTop: 16 }}>
          物料通管理系统 v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}
