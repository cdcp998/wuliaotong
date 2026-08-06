import { useState } from "react";
import { Dialog, Form, Input, List, NavBar, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { authApi, otherEndUrl, useAuthStore } from "@wlt/shared";

/** 我的（手机端 TabBar 第 5 项）：个人信息、修改密码、电脑版入口、退出登录。 */
export function MinePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [pwdVisible, setPwdVisible] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
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

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar>我的</NavBar>
      <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, padding: 16, margin: 12 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "#1668dc",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {(user?.real_name ?? "用")[0]}
        </div>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 600 }}>{user?.real_name}</div>
          <div style={{ fontSize: 12, color: "#86909c", marginTop: 3 }}>{user?.role?.name}</div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, margin: "0 12px 12px", overflow: "hidden" }}>
        <List style={{ "--border-top": "0" } as React.CSSProperties}>
          <List.Item onClick={() => setPwdVisible(true)} arrow="horizontal">
            修改密码
          </List.Item>
          <List.Item onClick={() => window.open(otherEndUrl("desktop"), "_blank")} arrow="horizontal">
            电脑版入口
          </List.Item>
          <List.Item
            onClick={async () => {
              await Dialog.alert({ content: "报表、系统管理等功能请使用电脑端操作。" });
            }}
            arrow="horizontal"
          >
            电脑端功能提示
          </List.Item>
          <List.Item onClick={() => void onLogout()}>退出登录</List.Item>
        </List>
      </div>

      <div style={{ padding: "0 16px", fontSize: 11, color: "#c9cdd4", lineHeight: 1.7, textAlign: "center" }}>
        物料通管理系统 v0.1.0<br />
        照片永久保存 · 全程操作留痕
      </div>

      <Dialog
        visible={pwdVisible}
        title="修改密码"
        content={
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item label="原密码">
              <Input type="password" placeholder="原密码" value={oldPwd} onChange={setOldPwd} />
            </Form.Item>
            <Form.Item label="新密码">
              <Input type="password" placeholder="至少 6 位" value={newPwd} onChange={setNewPwd} />
            </Form.Item>
            <Form.Item label="确认新密码">
              <Input type="password" placeholder="再次输入" value={confirmPwd} onChange={setConfirmPwd} />
            </Form.Item>
          </Form>
        }
        actions={[
          { key: "cancel", text: "取消" },
          { key: "ok", text: saving ? "提交中…" : "确定", onClick: () => void changePwd() },
        ]}
        onAction={(a) => {
          if (a.key === "cancel") setPwdVisible(false);
        }}
        onClose={() => setPwdVisible(false)}
      />
    </div>
  );
}
