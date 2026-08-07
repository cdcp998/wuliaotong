import { useState } from "react";
import { Button, Dialog, Form, Input, List, NavBar, Popup, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

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

      {/* 修改密码：全屏弹层界面（标题栏 + 账号提示 + 表单卡片 + 底部主按钮） */}
      <Popup visible={pwdVisible} onMaskClick={() => setPwdVisible(false)} bodyStyle={{ height: "100vh" }} destroyOnClose>
        <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#f5f6f8" }}>
          <NavBar
            onBack={() => setPwdVisible(false)}
            right={
              <span onClick={() => setPwdVisible(false)} style={{ fontSize: 14, color: "#1668dc", padding: "0 12px" }}>
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
              <span style={{ fontSize: 13, color: "#86909c" }}>当前账号</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{user?.username}</span>
            </div>
            {/* 表单卡片 */}
            <div style={{ background: "#fff", borderRadius: 12, padding: "4px 16px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 4px" }}>
                <span style={{ fontSize: 13, color: "#4e5969" }}>输入新密码</span>
                <span onClick={() => setShowPwd((v) => !v)} style={{ fontSize: 13, color: "#1668dc", padding: 4 }}>
                  {showPwd ? "隐藏密码" : "显示密码"}
                </span>
              </div>
              <Form layout="vertical" style={{ marginTop: 4 }}>
                <Form.Item label="原密码">
                  <Input type={showPwd ? "text" : "password"} placeholder="请输入原密码" value={oldPwd} onChange={setOldPwd} />
                </Form.Item>
                <Form.Item label="新密码" extra={<span style={{ fontSize: 11, color: "#86909c" }}>至少 6 位</span>}>
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
              <div style={{ fontSize: 11, color: "#c9cdd4", lineHeight: 1.6, marginTop: 4 }}>
                修改成功后请使用新密码登录；如忘记密码请联系管理员重置。
              </div>
            </div>
          </div>
          {/* 底部主操作 */}
          <div style={{ padding: 12, background: "#fff", borderTop: "1px solid #f0f1f3" }}>
            <Button block color="primary" loading={saving} onClick={() => void changePwd()}>
              确认修改
            </Button>
          </div>
        </div>
      </Popup>
    </div>
  );
}
