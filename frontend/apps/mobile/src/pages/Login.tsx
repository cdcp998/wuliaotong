import { useEffect, useState } from "react";
import { Button, Checkbox, Input, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { authApi, BizError, initApi, otherEndInitUrl, otherEndUrl, useAuthStore, type RegisterStatus } from "@wlt/shared";

type Mode = "login" | "forgot" | "reset" | "register";

/** 登录页（手机端）——OP 规格（设计页 M20）：渐变 Hero 280（Logo 行左上 + 大标语底部）
 * + r20 白卡表单（label 11px + 输入块 h40/r11/#F6F8FE 带前图标 + 主钮 r12 #5B7FFF
 * + 底部注册/忘记密码链接行）。
 *
 * ⚠️ 实现注意：输入采用受控 state（不走 Form.Item 注入）——antd-mobile Form 的绑定依赖
 * 「直接子元素」，包一层自定义容器会吞掉 value/onChange 导致永远「请输入账号」（已踩坑）。
 * 校验在提交函数内手动做，与 Toast 反馈风格一致。
 * 业务逻辑不变：未初始化跳电脑端初始化页、已登录直进主页、失败 3 次出验证码、记住登录。 */

const HERO_SUBTITLE: Record<Mode, string> = {
  login: "随身上报 · 移动办公",
  forgot: "找回密码",
  reset: "重置密码",
  register: "注册新账号",
};

const CARD_TITLE: Record<Mode, string> = {
  login: "登录",
  forgot: "找回密码",
  reset: "重置密码",
  register: "注册账号",
};

/** 输入块容器：h40 / r11 / #F6F8FE（OP「B horizontal 40 r11 bg#F6F8FE p0/12」）。 */
function FieldBox({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="wlt-login-field">
      <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      {children}
    </div>
  );
}

const UserIcon = (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#8A93A8" strokeWidth={2} strokeLinecap="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
);
const LockIcon = (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#8A93A8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
const MailIcon = (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#8A93A8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
);

/** label + 输入块 组合行（OP「In vertical gap4」）。 */
function FieldRow({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="wlt-login-label">{label}</div>
      <FieldBox icon={icon}>{children}</FieldBox>
    </div>
  );
}

export function LoginPage() {
  const loginAction = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("login");
  const [remember, setRemember] = useState(true); // 记住登录状态（默认勾选，与电脑端「记住我」一致）
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [captchaId, setCaptchaId] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  const [forgotInfo, setForgotInfo] = useState<{ method: string; contact_phone?: string; message: string } | null>(null);
  const [regStatus, setRegStatus] = useState<RegisterStatus | null>(null);

  // 受控表单（四模式各自字段；切换模式时重置）
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [realName, setRealName] = useState("");
  const [phone, setPhone] = useState("");

  function switchMode(next: Mode) {
    setMode(next);
    setUsername(""); setPassword(""); setCaptcha(""); setEmail(""); setCode(""); setNewPassword(""); setRealName(""); setPhone("");
  }

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

  async function submitLogin() {
    if (!username.trim()) return Toast.show("请输入账号");
    if (!password) return Toast.show("请输入密码");
    if (needCaptcha && !captcha.trim()) return Toast.show("请输入验证码");
    try {
      await loginAction(
        username.trim(),
        password,
        needCaptcha ? captchaId : "",
        needCaptcha ? captcha.trim().toUpperCase() : "",
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

  async function submitForgot() {
    if (!username.trim()) return Toast.show("请输入账号");
    try {
      const r = await authApi.forgot(username.trim(), email.trim() || undefined);
      setForgotInfo(r);
      const kept = username.trim();
      switchMode("reset");
      setUsername(kept); // 重置模式沿用刚填的账号
      Toast.show(r.message);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function submitReset() {
    if (!username.trim()) return Toast.show("请输入账号");
    if (!code.trim()) return Toast.show("请输入邮箱验证码");
    if (newPassword.length < 6) return Toast.show("新密码至少 6 位");
    try {
      const r = await authApi.forgotReset(username.trim(), code.trim(), newPassword);
      Toast.show(r.message);
      switchMode("login");
      setForgotInfo(null);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "重置失败");
    }
  }

  async function submitRegister() {
    if (username.trim().length < 2) return Toast.show("账号至少 2 个字符");
    if (password.length < 6) return Toast.show("密码至少 6 位");
    try {
      const r = await authApi.register({
        username: username.trim(),
        password,
        real_name: realName.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      Toast.show(r.message);
      switchMode("login");
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "注册失败");
    }
  }

  return (
    <div className="wlt-login" style={{ minHeight: "100dvh", background: "#F2F5FB", display: "flex", flexDirection: "column" }}>
      {/* 渐变 Hero（OP：高 280，135deg #5B7FFF→#7C93FF；Logo 行左上、大标语底部） */}
      <div
        style={{
          background: "linear-gradient(135deg,#5B7FFF 0%,#7C93FF 100%)",
          minHeight: 280,
          padding: "32px 24px 30px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
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
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", lineHeight: 1.5 }}>
            {mode === "reset" && forgotInfo?.message ? forgotInfo.message : HERO_SUBTITLE[mode]}
          </div>
          {mode === "reset" && forgotInfo?.method === "phone" && forgotInfo.contact_phone && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 4 }}>
              管理员联系电话：{forgotInfo.contact_phone}
            </div>
          )}
        </div>
      </div>

      {/* 表单卡（OP Card r20 白卡 p22/24，上叠 Hero 12px） */}
      <div style={{ padding: "12px 16px 24px", flex: 1 }}>
        <div className="wlt-glass-card" style={{ borderRadius: 20, padding: "22px 24px" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#1E2433", marginBottom: 14 }}>{CARD_TITLE[mode]}</div>

          {mode === "login" && (
            <>
              <FieldRow label="登录名" icon={UserIcon}>
                <Input placeholder="账号 / 用户名" value={username} onChange={setUsername} clearable autoFocus />
              </FieldRow>
              <FieldRow label="密码" icon={LockIcon}>
                <Input type="password" placeholder="密码" value={password} onChange={setPassword} clearable onEnterPress={() => void submitLogin()} />
              </FieldRow>
              {needCaptcha && (
                <div style={{ marginBottom: 12 }}>
                  <div className="wlt-login-label">验证码</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <FieldBox icon={MailIcon}>
                        <Input placeholder="4 位验证码" maxLength={4} value={captcha} onChange={setCaptcha} style={{ textTransform: "uppercase" }} />
                      </FieldBox>
                    </div>
                    <img
                      src={captchaImg}
                      alt="验证码"
                      title="点击刷新"
                      onClick={() => void refreshCaptcha()}
                      style={{ height: 40, width: 108, objectFit: "cover", borderRadius: 11, cursor: "pointer", flexShrink: 0 }}
                    />
                  </div>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "2px 0 14px" }}>
                <Checkbox checked={remember} onChange={(v) => setRemember(v)} style={{ "--icon-size": "16px", fontSize: 11.5, color: "#5B6478" } as React.CSSProperties}>
                  记住登录状态
                </Checkbox>
                <a onClick={() => switchMode("forgot")} style={{ fontSize: 11.5, color: "#5B7FFF" }}>
                  忘记密码
                </a>
              </div>
              <Button
                block
                color="primary"
                loading={loading}
                onClick={() => void submitLogin()}
                style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}
              >
                登 录
              </Button>
            </>
          )}

          {mode === "forgot" && (
            <>
              <FieldRow label="登录名" icon={UserIcon}>
                <Input placeholder="登录账号" value={username} onChange={setUsername} clearable autoFocus />
              </FieldRow>
              <FieldRow label="注册邮箱（邮箱找回时填写）" icon={MailIcon}>
                <Input placeholder="邮箱" value={email} onChange={setEmail} clearable />
              </FieldRow>
              <Button
                block
                color="primary"
                onClick={() => void submitForgot()}
                style={{ height: 44, marginTop: 6, fontSize: 14, fontWeight: 700, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}
              >
                发送验证码 / 查看联系方式
              </Button>
            </>
          )}

          {mode === "reset" && (
            <>
              <FieldRow label="登录名" icon={UserIcon}>
                <Input placeholder="登录账号" value={username} onChange={setUsername} clearable autoFocus />
              </FieldRow>
              <FieldRow label="邮箱验证码" icon={MailIcon}>
                <Input placeholder="邮箱中的 6 位验证码" maxLength={6} value={code} onChange={setCode} clearable />
              </FieldRow>
              <FieldRow label="新密码" icon={LockIcon}>
                <Input type="password" placeholder="至少 6 位" value={newPassword} onChange={setNewPassword} clearable onEnterPress={() => void submitReset()} />
              </FieldRow>
              <Button
                block
                color="primary"
                onClick={() => void submitReset()}
                style={{ height: 44, marginTop: 6, fontSize: 14, fontWeight: 700, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}
              >
                重置密码
              </Button>
            </>
          )}

          {mode === "register" && (
            <>
              <FieldRow label="登录名" icon={UserIcon}>
                <Input placeholder="字母 / 数字 / 下划线" value={username} onChange={setUsername} clearable autoFocus />
              </FieldRow>
              <FieldRow label="密码" icon={LockIcon}>
                <Input type="password" placeholder="至少 6 位" value={password} onChange={setPassword} clearable />
              </FieldRow>
              <FieldRow label="姓名（可选）" icon={UserIcon}>
                <Input placeholder="真实姓名" value={realName} onChange={setRealName} clearable />
              </FieldRow>
              <FieldRow label="手机（可选）" icon={UserIcon}>
                <Input placeholder="手机号" value={phone} onChange={setPhone} clearable />
              </FieldRow>
              <FieldRow label="邮箱（可选，找回密码用）" icon={MailIcon}>
                <Input placeholder="邮箱" value={email} onChange={setEmail} clearable />
              </FieldRow>
              <div style={{ fontSize: 11, color: "#8A93A8", lineHeight: 1.6, marginBottom: 10 }}>
                {regStatus?.mode === "review" ? "审核注册模式：提交后需管理员审核通过方可登录。" : "开放注册模式：注册即开通使用者账号。"}
              </div>
              <Button
                block
                color="primary"
                onClick={() => void submitRegister()}
                style={{ height: 44, fontSize: 14, fontWeight: 700, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}
              >
                注 册
              </Button>
            </>
          )}

          {/* 卡底链接行（OP：「注册账号（需管理员审核）· 忘记密码」11px #5B7FFF；非登录模式为返回登录） */}
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 11 }}>
            {mode === "login" ? (
              regStatus && regStatus.mode !== "closed" ? (
                <>
                  <a onClick={() => switchMode("forgot")} style={{ color: "#5B7FFF" }}>忘记密码</a>
                  <span style={{ color: "#CBD6EC", margin: "0 8px" }}>·</span>
                  <a onClick={() => switchMode("register")} style={{ color: "#5B7FFF" }}>注册账号（需管理员审核）</a>
                </>
              ) : (
                <a onClick={() => switchMode("forgot")} style={{ color: "#5B7FFF" }}>忘记密码</a>
              )
            ) : (
              /* 放在表单区外；内边距保证触屏目标 ≥44px */
              <a onClick={() => switchMode("login")} style={{ display: "inline-block", padding: "10px 24px", fontSize: 12.5, color: "#5B6478" }}>
                返回登录
              </a>
            )}
          </div>
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
