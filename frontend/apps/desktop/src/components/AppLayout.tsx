import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  App,
  Badge,
  Button,
  Dropdown,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  theme,
  type MenuProps,
} from "antd";
import {
  AppstoreOutlined,
  ApartmentOutlined,
  AuditOutlined,
  BellOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExportOutlined,
  FileSearchOutlined,
  FundOutlined,
  HddOutlined,
  InboxOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MobileOutlined,
  ProfileOutlined,
  RobotOutlined,
  SettingOutlined,
  ShopOutlined,
  SwapOutlined,
  UserOutlined,
} from "@ant-design/icons";

import { authApi, notificationApi, otherEndUrl, useAuthStore, type NotificationItem } from "@wlt/shared";

const { Sider, Header, Content } = Layout;

interface MenuNode {
  key: string;
  label: string;
  icon?: React.ReactNode;
  perm?: string;
  children?: MenuNode[];
}

/** 侧边导航分组（《UI设计方案.md》§3.2）：按权限点过滤。 */
const MENU: MenuNode[] = [
  {
    key: "work",
    label: "工作台",
    children: [{ key: "/dashboard", label: "经营看板", icon: <DashboardOutlined />, perm: "report:view" }],
  },
  {
    key: "base",
    label: "基础资料",
    children: [{ key: "/warehouses", label: "仓库与货架", icon: <ShopOutlined />, perm: "base:warehouse" }],
  },
  {
    key: "purchase",
    label: "采购管理",
    children: [
      { key: "/purchase-in", label: "采购入库", icon: <InboxOutlined />, perm: "pch:in" },
      { key: "/ocr/delivery", label: "送货单 OCR 录入", icon: <FileSearchOutlined />, perm: "pch:ocr" },
    ],
  },
  {
    key: "stock",
    label: "库存管理",
    children: [
      { key: "/stock", label: "库存查询", icon: <DatabaseOutlined />, perm: "stk:query" },
      { key: "/checks", label: "库存盘点", icon: <ProfileOutlined />, perm: "stk:check" },
      { key: "/transfers", label: "库存调拨", icon: <SwapOutlined />, perm: "stk:transfer" },
      { key: "/other-io", label: "其他出入库", icon: <ExportOutlined />, perm: "stk:other" },
    ],
  },
  {
    key: "req",
    label: "领用管理",
    children: [{ key: "/requisitions", label: "领用审计", icon: <AuditOutlined />, perm: "req:audit" }],
  },
  {
    key: "report",
    label: "报表中心",
    children: [
      { key: "/reports", label: "进销存报表", icon: <FundOutlined />, perm: "report:view" },
      { key: "/ai-suggestions", label: "AI 建议处理", icon: <RobotOutlined />, perm: "ocr:manage" },
    ],
  },
  {
    key: "sys",
    label: "系统管理",
    children: [
      { key: "/system/settings", label: "系统设置", icon: <SettingOutlined />, perm: "sys:config" },
      { key: "/system/users", label: "用户管理", icon: <UserOutlined />, perm: "sys:user" },
      { key: "/system/roles", label: "用户权限设置", icon: <ShopOutlined />, perm: "sys:role" },
      { key: "/system/register-applies", label: "注册审核", icon: <AuditOutlined />, perm: "sys:user" },
      { key: "/system/departments", label: "单位管理", icon: <ApartmentOutlined />, perm: "dept:manage" },
      { key: "/system/logs", label: "操作日志", icon: <AppstoreOutlined />, perm: "sys:log" },
      { key: "/system/backups", label: "备份管理", icon: <HddOutlined />, perm: "sys:backup" },
    ],
  },
];

const TITLES: Record<string, string> = {
  "/dashboard": "经营看板",
  "/warehouses": "仓库与货架",
  "/purchase-in": "采购入库",
  "/ocr/delivery": "送货单 OCR 录入",
  "/stock": "库存查询",
  "/checks": "库存盘点",
  "/transfers": "库存调拨",
  "/other-io": "其他出入库",
  "/requisitions": "领用审计",
  "/reports": "进销存报表",
  "/ai-suggestions": "AI 建议处理",
  "/system/settings": "系统设置",
  "/system/users": "用户管理",
  "/system/roles": "用户权限设置",
  "/system/logs": "操作日志",
  "/system/backups": "备份管理",
};

/** 电脑端应用骨架：侧边导航 + 顶栏（《UI设计方案.md》§3.2/§4）。 */
export function AppLayout({ children }: { children?: React.ReactNode }) {
  const { message } = App.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [notices, setNotices] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [search, setSearch] = useState("");
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdForm] = Form.useForm();
  const user = useAuthStore((s) => s.user);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  useEffect(() => {
    notificationApi
      .list(0)
      .then((d) => setNotices(d.list.slice(0, 5)))
      .catch(() => undefined);
    notificationApi
      .unreadCount()
      .then((d) => setUnread(d.unread_count))
      .catch(() => undefined);
  }, [location.pathname]);

  const menuItems: MenuProps["items"] = useMemo(
    () =>
      MENU.map((g) => ({
        key: g.key,
        label: g.label,
        type: "group" as const,
        children: g.children
          ?.filter((c) => !c.perm || hasPerm(c.perm))
          .map((c) => ({ key: c.key, icon: c.icon, label: c.label })),
      })).filter((g) => (g.children?.length ?? 0) > 0),
    [hasPerm]
  );

  const selectedKey = useMemo(() => {
    const hit = Object.keys(TITLES).find((k) => location.pathname.startsWith(k));
    return hit ?? "/dashboard";
  }, [location.pathname]);

  return (
    <>
      <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={216}
        collapsedWidth={64}
        theme="light"
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, boxShadow: "0 1px 2px rgba(31,35,41,.04)" }}
      >
        <div style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: token.colorPrimary,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            物
          </div>
          {!collapsed && (
            <div style={{ lineHeight: 1.1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>物料通</div>
              <div style={{ fontSize: 10, color: token.colorTextTertiary, letterSpacing: 1.5 }}>MATERIAL FLOW</div>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          items={menuItems}
          selectedKeys={[selectedKey]}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: "none", padding: "8px 0" }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            height: 56,
            padding: "0 20px",
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{TITLES[selectedKey] ?? "工作台"}</div>
          <Input.Search
            placeholder="搜索材料 / 单号 / 条码…"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => navigate(`/stock?keyword=${encodeURIComponent(v)}`)}
            style={{ width: 260, marginLeft: 8 }}
          />
          <div style={{ flex: 1 }} />
          <Dropdown
            trigger={["click"]}
            popupRender={() => (
              <div style={{ width: 340, background: "#fff", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                  <span style={{ fontWeight: 600 }}>站内通知</span>
                  <Button type="link" size="small" onClick={() => { notificationApi.markReadAll().then(() => { setUnread(0); setNotices([]); }); }}>
                    全部已读
                  </Button>
                </div>
                {notices.length === 0 && <div style={{ padding: 28, textAlign: "center", color: token.colorTextTertiary, fontSize: 13 }}>暂无未读通知</div>}
                {notices.map((n) => (
                  <div key={n.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${token.colorBorderSecondary}`, cursor: "pointer" }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{n.title}</div>
                    <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 2, lineHeight: 1.5 }}>{n.content}</div>
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 4 }}>{n.created_at.slice(0, 16)}</div>
                  </div>
                ))}
              </div>
            )}
          >
            <Badge count={unread} size="small">
              <Button type="text" icon={<BellOutlined style={{ fontSize: 17 }} />} />
            </Badge>
          </Dropdown>
          <Dropdown
            menu={{
              items: [
                { key: "mobile", icon: <MobileOutlined />, label: "手机版入口" },
                { key: "password", icon: <KeyOutlined />, label: "修改密码" },
                { type: "divider" },
                { key: "logout", icon: <LogoutOutlined />, label: "退出登录", danger: true },
              ],
              onClick: ({ key }) => {
                if (key === "mobile") window.open(otherEndUrl("mobile"), "_blank");
                if (key === "password") setPwdOpen(true);
                if (key === "logout") void logout().then(() => navigate("/login"));
              },
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: "4px 8px", borderRadius: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: token.colorPrimary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600 }}>
                {(user?.real_name ?? "用")[0]}
              </div>
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{user?.real_name}</div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{user?.role?.name ?? ""}</div>
              </div>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ background: "#f5f6f8", overflow: "auto" }}>
          {children}
        </Content>
      </Layout>
    </Layout>

    <Modal
      title="修改密码"
      open={pwdOpen}
      confirmLoading={pwdSaving}
      onOk={async () => {
        const v = await pwdForm.validateFields();
        if (v.new_password !== v.confirm) {
          message.error("两次输入的新密码不一致");
          return;
        }
        setPwdSaving(true);
        try {
          await authApi.changePassword(v.old_password, v.new_password);
          message.success("密码已修改");
          setPwdOpen(false);
          pwdForm.resetFields();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "修改失败");
        } finally {
          setPwdSaving(false);
        }
      }}
      onCancel={() => setPwdOpen(false)}
      destroyOnHidden
    >
      <Form form={pwdForm} layout="vertical">
        <Form.Item name="old_password" label="原密码" rules={[{ required: true, message: "请输入原密码" }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="new_password" label="新密码" rules={[{ required: true, min: 6, message: "至少 6 位" }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="confirm" label="确认新密码" rules={[{ required: true, message: "请再次输入" }]}>
          <Input.Password />
        </Form.Item>
      </Form>
    </Modal>
    </>
  );
}
