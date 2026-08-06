import { useEffect, useState } from "react";
import { Button, Form, Input, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { authApi, BizError, otherEndUrl, useAuthStore, type RegisterStatus } from "@wlt/shared";

type Mode = "login" | "forgot" | "reset" | "register";

/** 登录页（手机端）：品牌区 + 表单；已登录直进主页；失败 3 次需验证码；忘记密码/注册。 */
export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("login");
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [forgotInfo, setForgotInfo] = useState<{ method: string; contact_phone?: string; message: string } | null>(null);
  const [regStatus, setRegStatus] = useState<RegisterStatus | null>(null);

  useEffect(() => {
    fetchMe()
      .then(() => navigate("/", { replace: true })) // 已登录 → 主页
      .catch(() => undefined);
    authApi.registerStatus().then(setRegStatus).catch(() => undefined);
  }, [fetchMe, navigate]);

  async function refreshCaptcha() {
    const d = await authApi.captcha();
    setCaptchaId(d.captcha_id);
    setCaptchaImg(`data:image/png;base64,${d.image}`);
  }

  async function onSubmit(values: { username: string; password: string; captcha?: string }) {
    try {
      await login(values.username, values.password, needCaptcha ? captchaId : "", needCaptcha ? (values.captcha ?? "") : "");
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
      setMode(r.method === "phone" ? "reset" : "reset");
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

  return (
    <div style={{ minHeight: "100vh", background: "#fff", display: "flex", flexDirection: "column" }}>
      {/* 品牌区 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "44px 0 8px" }}>
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 15,
            background: "#1668dc",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            fontWeight: 700,
            boxShadow: "0 6px 18px rgba(22,104,220,.32)",
          }}
        >
          物
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, marginTop: 12 }}>物料通</div>
        <div style={{ fontSize: 12, color: "#86909c", marginTop: 3 }}>
          {mode === "login" ? "企业内部物料管理 · 入库 / 出库 / 领用" : mode === "forgot" ? "找回密码" : mode === "reset" ? forgotInfo?.message ?? "重置密码" : "注册账号"}
        </div>
      </div>

      {/* 表单区 */}
      <div style={{ padding: "20px 24px", flex: 1 }}>
        {mode === "login" && (
          <Form layout="vertical" onFinish={(v) => void onSubmit(v as { username: string; password: string; captcha?: string })} footer={
            <Button block type="submit" color="primary" size="large" loading={loading} style={{ height: 44, fontSize: 15, borderRadius: 10 }}>
              登 录
            </Button>
          }>
            <Form.Item name="username" rules={[{ required: true, message: "请输入账号" }]}>
              <Input placeholder="账号 / 用户名" clearable autoFocus />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
              <Input type="password" placeholder="密码" clearable />
            </Form.Item>
            {needCaptcha && (
              <Form.Item name="captcha" rules={[{ required: true, message: "请输入验证码" }]}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Input placeholder="4 位验证码" maxLength={4} style={{ flex: 1, textTransform: "uppercase" }} />
                  <img src={captchaImg} alt="验证码" title="点击刷新" onClick={() => void refreshCaptcha()} style={{ height: 40, borderRadius: 8, cursor: "pointer" }} />
                </div>
              </Form.Item>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, color: "#86909c", margin: "2px 2px 0" }}>
              <span>记住登录状态</span>
              <span>
                <a onClick={() => setMode("forgot")} style={{ marginRight: 10 }}>忘记密码？</a>
                {regStatus && regStatus.mode !== "closed" && <a onClick={() => setMode("register")}>注册账号</a>}
              </span>
            </div>
          </Form>
        )}

        {mode === "forgot" && (
          <Form
            layout="vertical"
            onFinish={(v) => void doForgot(v as { username: string; email?: string })}
            footer={
              <Button block type="submit" color="primary" size="large" style={{ height: 44, fontSize: 15, borderRadius: 10 }}>
                发送验证码 / 查看联系方式
              </Button>
            }
          >
            <Form.Item name="username" rules={[{ required: true, message: "请输入账号" }]}>
              <Input placeholder="登录账号" clearable />
            </Form.Item>
            <Form.Item name="email" label="注册邮箱（邮箱找回时填写）">
              <Input placeholder="邮箱" clearable />
            </Form.Item>
            <Button block size="small" fill="none" onClick={() => setMode("login")}>返回登录</Button>
          </Form>
        )}

        {mode === "reset" && (
          <Form
            layout="vertical"
            onFinish={(v) => void doReset(v as { username: string; code: string; new_password: string })}
            footer={
              <Button block type="submit" color="primary" size="large" style={{ height: 44, fontSize: 15, borderRadius: 10 }}>
                重置密码
              </Button>
            }
          >
            {forgotInfo?.method === "phone" && forgotInfo.contact_phone && (
              <div style={{ fontSize: 14, color: "#1668dc", textAlign: "center", marginBottom: 12 }}>
                管理员联系电话：{forgotInfo.contact_phone}
              </div>
            )}
            <Form.Item name="username" rules={[{ required: true, message: "请输入账号" }]}>
              <Input placeholder="登录账号" clearable />
            </Form.Item>
            <Form.Item name="code" rules={[{ required: true, message: "请输入邮箱验证码" }]}>
              <Input placeholder="邮箱中的 6 位验证码" maxLength={6} clearable />
            </Form.Item>
            <Form.Item name="new_password" rules={[{ required: true, min: 6, message: "至少 6 位" }]}>
              <Input type="password" placeholder="新密码（至少 6 位）" clearable />
            </Form.Item>
            <Button block size="small" fill="none" onClick={() => setMode("login")}>返回登录</Button>
          </Form>
        )}

        {mode === "register" && (
          <Form
            layout="vertical"
            onFinish={(v) => void doRegister(v as { username: string; password: string; real_name?: string; phone?: string; email?: string })}
            footer={
              <Button block type="submit" color="primary" size="large" style={{ height: 44, fontSize: 15, borderRadius: 10 }}>
                注 册
              </Button>
            }
          >
            <Form.Item name="username" rules={[{ required: true, min: 2, message: "至少 2 个字符" }]}>
              <Input placeholder="账号（字母/数字/下划线）" clearable />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, min: 6, message: "至少 6 位" }]}>
              <Input type="password" placeholder="密码（至少 6 位）" clearable />
            </Form.Item>
            <Form.Item name="real_name"><Input placeholder="姓名（可选）" clearable /></Form.Item>
            <Form.Item name="phone"><Input placeholder="手机（可选）" clearable /></Form.Item>
            <Form.Item name="email"><Input placeholder="邮箱（可选，找回密码用）" clearable /></Form.Item>
            <div style={{ fontSize: 12, color: "#86909c", textAlign: "center", marginBottom: 10 }}>
              {regStatus?.mode === "review" ? "审核注册模式：提交后需管理员审核通过方可登录。" : "开放注册模式：注册即开通使用者账号。"}
            </div>
            <Button block size="small" fill="none" onClick={() => setMode("login")}>返回登录</Button>
          </Form>
        )}

        {mode === "login" && (
          <div style={{ textAlign: "center", fontSize: 12, color: "#86909c", marginTop: 18 }}>
            大屏操作请前往 <a href={otherEndUrl("desktop")} style={{ color: "#1668dc" }}>电脑版入口</a>
          </div>
        )}
      </div>
    </div>
  );
}
