import { useState } from "react";
import { Button, Dialog, Form, Input, NavBar, Popup, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { authApi, otherEndUrl, useAuthStore } from "@wlt/shared";

/** 我的（手机端 TabBar 第 5 项）——OP 规格（设计页 M6）：
 * 头像卡（52×52 r16 品牌底 + 姓名/「角色 · 账号」副行 + 右箭头）
 * + 菜单组（r16 白卡：个人信息/修改密码/电脑版入口/消息通知设置/退出登录，行 p14/13 + 左图标 + 右箭头）
 * + 版本脚注。修改密码沿用全屏弹层。 */
export function MinePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [pwdVisible, setPwdVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false); // 个人信息（只读展示）
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false); // 密码可见性（三字段统一切换）
  const [saving, setSaving] = useState(false);

  async function onLogout() {
    const confirmed = await Dialog.confirm({ content: "确认退出登录？" });
    if (!confirmed) return;
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "退出失败");
    }
  }

  async function changePwd() {
    if (!oldPwd || !newPwd) return Toast.show("请输入完整信息");
    if (newPwd.length < 6) return Toast.show("新密码至少 6 位");
    if (newPwd !== confirmPwd) return Toast.show("两次输入的新密码不一致");
    setSaving(true);
    try {
      await authApi.changePassword(oldPwd, newPwd);
      Toast.show("密码已修改");
      setPwdVisible(false);
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "修改失败");
    } finally {
      setSaving(false);
    }
  }

  /** 菜单行（OP MR：p14/13 gap10，左图标 17×17 stroke，右箭头 12px）。 */
  function MenuRow({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
    return (
      <div
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 13px",
          cursor: "pointer",
          borderBottom: "1px solid #F2F5FB",
        }}
      >
        <span style={{ display: "inline-flex", color: danger ? "#DC2626" : "#5B6478" }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: danger ? "#DC2626" : "#1E2433" }}>{label}</span>
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="#8A93A8" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar onBack={() => navigate("/")}>我的</NavBar>

      {/* 头像卡（OP Profile r18 白卡 p16 gap12） */}
      <div
        onClick={() => setInfoVisible(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "#fff",
          border: "1px solid #E4EAF6",
          borderRadius: 18,
          padding: 16,
          margin: 12,
          boxShadow: "0 6px 20px rgba(30,36,51,.06)",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            background: "#5B7FFF",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {(user?.real_name ?? "用")[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1E2433" }}>{user?.real_name || user?.username}</div>
          {/* 班组字段后端暂无（UserInfo 无 team），以「角色 · @账号」代替，后续加班组字段时替换 */}
          <div style={{ fontSize: 11.5, color: "#8A93A8", marginTop: 3 }}>
            {user?.role?.name ?? "未分配角色"} · @{user?.username}
          </div>
        </div>
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#8A93A8" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>

      {/* 菜单组（OP Menu r16 白卡 p4/0） */}
      <div style={{ background: "#fff", border: "1px solid #E4EAF6", borderRadius: 16, margin: "0 12px 12px", overflow: "hidden", boxShadow: "0 6px 20px rgba(30,36,51,.06)" }}>
        <MenuRow
          label="个人信息"
          onClick={() => setInfoVisible(true)}
          icon={
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" />
            </svg>
          }
        />
        <MenuRow
          label="消息通知设置"
          onClick={() => navigate("/notifications")}
          icon={
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
          }
        />
        <MenuRow
          label="修改密码"
          onClick={() => setPwdVisible(true)}
          icon={
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          }
        />
        <MenuRow
          label="电脑版入口"
          onClick={() => window.open(otherEndUrl("desktop"), "_blank")}
          icon={
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
            </svg>
          }
        />
        <div style={{ borderBottom: "1px solid #F2F5FB" }} />
        <MenuRow
          label="退出登录"
          danger
          onClick={() => void onLogout()}
          icon={
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5M21 12H9" />
            </svg>
          }
        />
      </div>

      <div style={{ padding: "0 16px", fontSize: 10.5, color: "#8A93A8", lineHeight: 1.7, textAlign: "center" }}>
        物料通管理系统 v{__APP_VERSION__}<br />
        照片永久保存 · 全程操作留痕
      </div>

      {/* 个人信息弹层（只读；OP M6 菜单项「个人信息」落地） */}
      <Popup visible={infoVisible} onMaskClick={() => setInfoVisible(false)} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <div style={{ padding: "16px 16px 28px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>个人信息</div>
          <div className="wlt-card" style={{ borderRadius: 14, overflow: "hidden" }}>
            {[
              ["账号", user?.username ?? "—"],
              ["姓名", user?.real_name || "—"],
              ["角色", user?.role?.name ?? "—"],
              ["用户 ID", String(user?.id ?? "—")],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #F2F5FB" }}>
                <span style={{ fontSize: 12.5, color: "#5B6478" }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#1E2433" }}>{v}</span>
              </div>
            ))}
          </div>
          <Button block color="primary" onClick={() => setInfoVisible(false)} style={{ marginTop: 14, borderRadius: 12, background: "#5B7FFF", borderColor: "#5B7FFF" }}>
            关闭
          </Button>
        </div>
      </Popup>

      {/* 修改密码：全屏弹层界面（标题栏 + 账号提示 + 表单卡片 + 底部主按钮） */}
      <Popup visible={pwdVisible} onMaskClick={() => setPwdVisible(false)} bodyStyle={{ height: "100dvh" }} destroyOnClose>
        <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#F2F5FB" }}>
          <NavBar
            onBack={() => setPwdVisible(false)}
            right={
              <span onClick={() => setPwdVisible(false)} style={{ fontSize: 14, color: "#3B5BDB", padding: "0 12px" }}>
                关闭
              </span>
            }
            style={{ background: "#fff", borderBottom: "1px solid #f0f1f3" }}
          >
            修改密码
          </NavBar>
          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {/* 当前账号提示 */}
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                padding: "12px 16px",
                marginBottom: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 13, color: "#5B6478" }}>当前账号</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{user?.username}</span>
            </div>
            {/* 表单卡片 */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "4px 16px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 4px" }}>
                <span style={{ fontSize: 13, color: "#5B6478" }}>输入新密码</span>
                <span onClick={() => setShowPwd((v) => !v)} style={{ fontSize: 13, color: "#3B5BDB", padding: 4 }}>
                  {showPwd ? "隐藏密码" : "显示密码"}
                </span>
              </div>
              <Form layout="vertical" style={{ marginTop: 4 }}>
                <Form.Item label="原密码">
                  <Input type={showPwd ? "text" : "password"} placeholder="请输入原密码" value={oldPwd} onChange={setOldPwd} />
                </Form.Item>
                <Form.Item label="新密码" extra={<span style={{ fontSize: 11, color: "#5B6478" }}>至少 6 位</span>}>
                  <Input type={showPwd ? "text" : "password"} placeholder="请输入新密码" value={newPwd} onChange={setNewPwd} />
                </Form.Item>
                <Form.Item label="确认新密码">
                  <Input
                    type={showPwd ? "text" : "password"}
                    placeholder="再次输入新密码"
                    value={confirmPwd}
                    onChange={setConfirmPwd}
                    onEnterPress={() => void changePwd()}
                  />
                </Form.Item>
              </Form>
              <div style={{ fontSize: 11, color: "#8A93A8", lineHeight: 1.6, marginTop: 4 }}>
                修改成功后请使用新密码登录；如忘记密码请联系管理员重置。
              </div>
            </div>
          </div>
          {/* 底部主操作 */}
          <div style={{ padding: 12, background: "#fff", borderTop: "1px solid #f0f1f3" }}>
            <Button block color="primary" loading={saving} onClick={() => void changePwd()} style={{ background: "#5B7FFF", borderColor: "#5B7FFF" }}>
              确认修改
            </Button>
          </div>
        </div>
      </Popup>
    </div>
  );
}
