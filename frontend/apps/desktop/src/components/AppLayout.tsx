import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  App,
  AutoComplete,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Spin,
  Tabs,
  Tag,
  theme,
  type MenuProps,
} from "antd";
import {
  AppstoreOutlined,
  ApartmentOutlined,
  AuditOutlined,
  BankOutlined,
  BellOutlined,
  ContactsOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  EditOutlined,
  ExportOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FundOutlined,
  HddOutlined,
  InboxOutlined,
  KeyOutlined,
  LineChartOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MobileOutlined,
  NumberOutlined,
  ProfileOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  SwapOutlined,
  TableOutlined,
  UserOutlined,
  DeploymentUnitOutlined,
  EnvironmentOutlined,
  AlertOutlined,
  CloudDownloadOutlined,
  ToolOutlined,
  ProjectOutlined,
  UnorderedListOutlined,
  ReadOutlined,
  DesktopOutlined,
} from "@ant-design/icons";

import { authApi, notificationApi, otherEndUrl, useAuthStore, type MenuNode, type NotificationItem } from "@wlt/shared";

const { Sider, Header, Content } = Layout;

/** 硬编码菜单定义（动态菜单未就绪时的兜底渲染）。 */
interface MenuNodeDef {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** 权限点：单个字符串或数组（数组=任一命中即可见，如合并页「物料数据管理」）。 */
  perm?: string | string[];
  children?: MenuNodeDef[];
}

/** 菜单可见性校验：无 perm 恒可见；单个按 hasPerm；数组按任一命中。 */
function menuVisible(perm: string | string[] | undefined, hasPerm: (c: string) => boolean, hasAnyPerm: (cs: string[]) => boolean): boolean {
  if (!perm) return true;
  if (Array.isArray(perm)) return hasAnyPerm(perm);
  return hasPerm(perm);
}

/** 侧边导航分组（《UI设计方案.md》§3.2）：按权限点过滤。 */
export const MENU: MenuNodeDef[] = [
  {
    key: "work",
    label: "工作台",
    icon: <DashboardOutlined />,
    children: [{ key: "/dashboard", label: "统计面板", icon: <DashboardOutlined />, perm: "report:view" }],
  },
  {
    key: "base",
    label: "基础资料",
    icon: <ShopOutlined />,
    children: [
      { key: "/materials-data", label: "物料数据管理", icon: <AppstoreOutlined />, perm: ["base:product", "base:category"] },
      { key: "/delete-reviews", label: "删除审核", icon: <AuditOutlined />, perm: ["base:product", "base:category"] },
      { key: "/suppliers", label: "供应商管理", icon: <ContactsOutlined />, perm: "base:supplier" },
      { key: "/units", label: "材料单位管理", icon: <NumberOutlined />, perm: "base:product" },
    ],
  },
  {
    key: "purchase",
    label: "入库管理",
    icon: <InboxOutlined />,
    children: [
      { key: "/purchase-plans", label: "采购计划单", icon: <FileTextOutlined />, perm: "pch:in" },
      { key: "/purchase-in", label: "材料入库", icon: <InboxOutlined />, perm: "pch:in" },
      { key: "/ocr/delivery", label: "送货单识别入库", icon: <FileSearchOutlined />, perm: "pch:ocr" },
    ],
  },
  {
    key: "stock",
    label: "库存管理",
    icon: <DatabaseOutlined />,
    children: [
      { key: "/stock", label: "库存查询", icon: <TableOutlined />, perm: "stk:query" },
      { key: "/warehouses", label: "仓库与货架", icon: <BankOutlined />, perm: "base:warehouse" },
      { key: "/history-price", label: "历史价格管理", icon: <LineChartOutlined />, perm: "stk:query" },
      { key: "/transfers", label: "库存调拨", icon: <SwapOutlined />, perm: "stk:transfer" },
      { key: "/other-io", label: "其他出入库", icon: <ExportOutlined />, perm: "stk:other" },
    ],
  },
  {
    key: "req-manage",
    label: "领用管理",
    icon: <EditOutlined />,
    children: [
      { key: "/requisitions/apply", label: "领用申请", icon: <EditOutlined />, perm: "req:apply" },
      { key: "/requisitions/query", label: "领用申请单查询", icon: <SearchOutlined />, perm: "req:audit" },
      { key: "/requisitions", label: "领用审计", icon: <AuditOutlined />, perm: "req:audit" },
    ],
  },
  {
    key: "report",
    label: "报表中心",
    icon: <FundOutlined />,
    children: [
      { key: "/reports", label: "报表中心", icon: <FundOutlined />, perm: "report:view" },
      { key: "/checks", label: "盘点", icon: <ProfileOutlined />, perm: "stk:check" },
      { key: "/ai-suggestions", label: "AI 建议处理", icon: <RobotOutlined />, perm: "ai:suggestion" },
    ],
  },
  {
    key: "sys",
    label: "系统管理",
    icon: <SettingOutlined />,
    children: [
      { key: "/system/users", label: "用户管理", icon: <UserOutlined />, perm: "sys:user" },
      { key: "/system/roles", label: "用户权限设置", icon: <SafetyCertificateOutlined />, perm: "sys:role" },
      { key: "/system/menus", label: "导航管理", icon: <MenuOutlined />, perm: "sys:role" },
      { key: "/system/register-applies", label: "注册审核", icon: <AuditOutlined />, perm: "sys:user" },
      { key: "/system/departments", label: "单位管理", icon: <ApartmentOutlined />, perm: "dept:manage" },
      { key: "/system/logs", label: "操作日志", icon: <FileTextOutlined />, perm: "sys:log" },
      { key: "/system/backups", label: "备份管理", icon: <HddOutlined />, perm: "sys:backup" },
      { key: "/llm-logs", label: "AI 调用日志", icon: <RobotOutlined />, perm: "sys:llm-log" },
      { key: "/system/settings", label: "系统设置", icon: <SettingOutlined />, perm: "sys:config" },
    ],
  },
];

/** 通知分类标签样式（与手机端一致）。 */
const BIZ_STYLE: Record<string, { text: string; color: string }> = {
  "预警": { text: "预警", color: "red" },
  "待办": { text: "待办", color: "orange" },
  "审批": { text: "审批", color: "blue" },
};

const TITLES: Record<string, string> = {
  "/dashboard": "统计面板",
  "/materials-data": "物料数据管理",
  "/delete-reviews": "删除审核",
  "/suppliers": "供应商管理",
  "/units": "材料单位管理",
  "/warehouses": "仓库与货架",
  "/purchase-in": "材料入库",
  "/purchase-plans": "采购计划单",
  "/ocr/delivery": "送货单识别入库",
  "/stock": "库存查询",
  "/checks": "盘点",
  "/transfers": "库存调拨",
  "/history-price": "历史价格管理",
  "/requisitions/apply": "领用申请",
  "/requisitions/query": "领用申请单查询",
  "/other-io": "其他出入库",
  "/requisitions": "领用审计",
  "/reports": "报表中心",
  "/ai-suggestions": "AI 建议处理",
  "/system/settings": "系统设置",
  "/system/users": "用户管理",
  "/system/roles": "用户权限设置",
  "/system/menus": "导航管理",
  "/system/logs": "操作日志",
  "/system/backups": "备份管理",
  "/llm-logs": "AI 调用日志",
};

/** 图标注册表：导航菜单 icon 字段（字符串名）→ 组件；未注册的显示占位。 */
export const ICON_MAP: Record<string, React.ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  ShopOutlined: <ShopOutlined />,
  AppstoreOutlined: <AppstoreOutlined />,
  AuditOutlined: <AuditOutlined />,
  ContactsOutlined: <ContactsOutlined />,
  NumberOutlined: <NumberOutlined />,
  BankOutlined: <BankOutlined />,
  InboxOutlined: <InboxOutlined />,
  FileTextOutlined: <FileTextOutlined />,
  FileSearchOutlined: <FileSearchOutlined />,
  DatabaseOutlined: <DatabaseOutlined />,
  TableOutlined: <TableOutlined />,
  LineChartOutlined: <LineChartOutlined />,
  SwapOutlined: <SwapOutlined />,
  ExportOutlined: <ExportOutlined />,
  EditOutlined: <EditOutlined />,
  SearchOutlined: <SearchOutlined />,
  FundOutlined: <FundOutlined />,
  ProfileOutlined: <ProfileOutlined />,
  RobotOutlined: <RobotOutlined />,
  SettingOutlined: <SettingOutlined />,
  UserOutlined: <UserOutlined />,
  SafetyCertificateOutlined: <SafetyCertificateOutlined />,
  ApartmentOutlined: <ApartmentOutlined />,
  HddOutlined: <HddOutlined />,
  MenuOutlined: <MenuOutlined />,
  DeploymentUnitOutlined: <DeploymentUnitOutlined />,
  EnvironmentOutlined: <EnvironmentOutlined />,
  AlertOutlined: <AlertOutlined />,
  CloudDownloadOutlined: <CloudDownloadOutlined />,
  ToolOutlined: <ToolOutlined />,
  ProjectOutlined: <ProjectOutlined />,
  UnorderedListOutlined: <UnorderedListOutlined />,
  ReadOutlined: <ReadOutlined />,
  DesktopOutlined: <DesktopOutlined />,
};

/** 导航项（动态菜单 / 硬编码 MENU 统一形态）。 */
interface NavItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  path?: string;
  children?: NavItem[];
}

function menuIcon(name?: string): React.ReactNode {
  return (name && ICON_MAP[name]) || <AppstoreOutlined />;
}

/** 动态菜单（DB sys_menu）→ 导航项；分组 key=menu-{id}，叶子 key=path。 */
function toNavItem(m: MenuNode): NavItem {
  const children = m.children?.length ? m.children.map(toNavItem) : undefined;
  const isGroup = Boolean(children?.length);
  return {
    key: isGroup ? `menu-${m.id}` : (m.path || `menu-${m.id}`),
    label: m.name,
    icon: menuIcon(m.icon),
    path: m.path,
    children,
  };
}

/** 拍平叶子（导航搜索 / 路径→标题）。 */
function flattenNav(nav: NavItem[]): { path: string; label: string; group: string }[] {
  const out: { path: string; label: string; group: string }[] = [];
  const walk = (ns: NavItem[], group: string) => {
    for (const n of ns) {
      if (n.children?.length) walk(n.children, group || n.label);
      else if (n.path) out.push({ path: n.path, label: n.label, group });
    }
  };
  walk(nav, "");
  return out;
}

/** 导航树是否包含指定 key（含子孙，用于定位当前所属分组）。 */
function containsNavKey(n: NavItem, key: string): boolean {
  return n.key === key || (n.children?.some((c) => containsNavKey(c, key)) ?? false);
}

/** 通知 link（移动端路由形态）→ 桌面对应页面；无对应页面返回空（仅标记已读不跳转）。 */
function desktopLink(link: string): string {
  if (!link) return "";
  if (link.startsWith("/requisitions/")) return "/requisitions"; // 领用详情 → 领用审计列表
  if (link === "/stock/query") return "/stock";
  if (link.startsWith("/delete-reviews")) return "/delete-reviews";
  return "";
}

/** 电脑端应用骨架：侧边导航 + 顶栏（《UI设计方案.md》§3.2/§4）。
 * 通知中心：顶栏铃铛 → 抽屉，与手机端通知页同功能（未读/全部、标记已读、删除、全选一键删除、清空、点击联动）。 */
export function AppLayout({ children }: { children?: React.ReactNode }) {
  const { message, modal } = App.useApp();
  // 平板/窄窗（≤992px，与 mobile.css 断点一致）默认折叠为 64px 图标栏，避免展开导航遮住内容；
  // 桌面端保持默认展开。折叠状态切换仍由顶栏按钮控制；跨断点自动跟随。
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= 992);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 992px)");
    const onChange = () => setCollapsed((c) => (mq.matches ? c : false) as boolean);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [noticeOpen, setNoticeOpen] = useState(false); // 通知中心抽屉
  const [notices, setNotices] = useState<NotificationItem[]>([]);
  const [noticeTab, setNoticeTab] = useState<"unread" | "all">("unread"); // 未读 / 全部
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeSelected, setNoticeSelected] = useState<Set<number>>(new Set());
  const [unread, setUnread] = useState(0);
  const [search, setSearch] = useState("");
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdForm] = Form.useForm();
  const user = useAuthStore((s) => s.user);
  const menus = useAuthStore((s) => s.menus);
  const fetchMenus = useAuthStore((s) => s.fetchMenus);
  const fetchModules = useAuthStore((s) => s.fetchModules);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const hasAnyPerm = useAuthStore((s) => s.hasAnyPerm);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  // 内容滚动容器：路由切换（点击侧边导航/顶栏搜索）后回到顶端，避免保留上一页滚动位置
  const contentRef = useRef<HTMLElement | null>(null);

  // 登录后拉取动态菜单与模块状态（模块停用 → 菜单/权限过滤；未拉取/失败回退硬编码 MENU）
  // 模块状态已由 RequireAuth 触发；此处仅兜底（modulesStatus=idle 时），避免重复拉取
  useEffect(() => {
    if (user) {
      if (menus.length === 0) void fetchMenus();
      if (useAuthStore.getState().modulesStatus === "idle") void fetchModules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 统一导航树：动态菜单优先，硬编码 MENU 兜底（无权限子项过滤）
  const navTree = useMemo<NavItem[]>(() => {
    if (menus.length) return menus.map(toNavItem);
    return MENU.map((g) => ({
      key: g.key,
      label: g.label,
      icon: g.icon,
      children: g.children
        ?.filter((c) => menuVisible(c.perm, hasPerm, hasAnyPerm))
        .map((c) => ({ key: c.key, label: c.label, icon: c.icon, path: c.key, children: undefined })),
    })).filter((g) => (g.children?.length ?? 0) > 0) as NavItem[];
  }, [menus, hasPerm, hasAnyPerm]);

  /** 滚动到顶端：兼容「内容区自身滚动」与「页面(窗口)滚动」两种布局。 */
  function scrollContentTop() {
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  useEffect(() => {
    scrollContentTop();
  }, [location.pathname]);

  useEffect(() => {
    notificationApi
      .unreadCount()
      .then((d) => setUnread(d.unread_count))
      .catch(() => undefined);
  }, [location.pathname]);

  // ==================== 通知中心（与手机端同功能） ====================

  /** 拉取通知列表（按当前 tab：未读 / 全部，取前 50 条）。 */
  const loadNotices = useCallback(
    (tab: "unread" | "all" = noticeTab) => {
      setNoticeLoading(true);
      notificationApi
        .list(tab === "unread" ? 0 : undefined, 1, 50)
        .then((d) => setNotices(d.list))
        .catch(() => message.error("通知加载失败"))
        .finally(() => setNoticeLoading(false));
    },
    [noticeTab, message]
  );

  /** 刷新未读徽标。 */
  const refreshUnread = useCallback(() => {
    notificationApi
      .unreadCount()
      .then((d) => setUnread(d.unread_count))
      .catch(() => undefined);
  }, []);

  // 打开抽屉即加载；tab 切换重新加载
  useEffect(() => {
    if (noticeOpen) {
      loadNotices();
      refreshUnread();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeOpen, noticeTab]);

  /** 通知点击：未读先标记已读；有联动链接则跳转桌面对应页面。 */
  function onNoticeClick(n: NotificationItem) {
    if (!n.is_read) {
      notificationApi
        .markRead(n.id)
        .then(() => {
          setNotices((ns) => ns.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
          refreshUnread();
        })
        .catch(() => undefined);
    }
    const link = desktopLink(n.link);
    if (link) navigate(link);
  }

  function toggleNoticeSelect(id: number) {
    setNoticeSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = notices.length > 0 && noticeSelected.size === notices.length;

  function toggleSelectAll() {
    setNoticeSelected(allSelected ? new Set() : new Set(notices.map((n) => n.id)));
  }

  /** 删除选中的通知（一键）。 */
  async function deleteSelectedNotices() {
    const ids = [...noticeSelected];
    if (!ids.length) return;
    const ok = await modal.confirm({
      title: "删除通知",
      content: `确定删除选中的 ${ids.length} 条通知？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
    });
    if (!ok) return;
    try {
      await notificationApi.removeMany(ids);
      setNotices((ns) => ns.filter((x) => !noticeSelected.has(x.id)));
      setNoticeSelected(new Set());
      refreshUnread();
      message.success(`已删除 ${ids.length} 条通知`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  /** 清空全部通知。 */
  async function clearAllNotices() {
    const ok = await modal.confirm({
      title: "清空通知",
      content: "确定清空全部通知？此操作不可恢复。",
      okText: "清空",
      okButtonProps: { danger: true },
      cancelText: "取消",
    });
    if (!ok) return;
    try {
      const r = await notificationApi.removeAll();
      setNotices([]);
      setNoticeSelected(new Set());
      refreshUnread();
      message.success(`已清空 ${r.deleted} 条通知`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "清空失败");
    }
  }

  /** 单条删除。 */
  async function removeOneNotice(n: NotificationItem) {
    try {
      await notificationApi.remove(n.id);
      setNotices((ns) => ns.filter((x) => x.id !== n.id));
      setNoticeSelected((s) => {
        const next = new Set(s);
        next.delete(n.id);
        return next;
      });
      refreshUnread();
      message.success("已删除");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  // 可折叠导航：主导航分类渲染为内联子菜单（点击标题展开/收起其子项），
  // 无权限子项过滤、空分类隐藏；展开状态由 antd 内部维护，选中项所在分类自动展开
  // 导航搜索：匹配菜单项（含权限过滤），选中直接跳转
  const navLeaves = useMemo(() => flattenNav(navTree), [navTree]);
  const [navKw, setNavKw] = useState("");
  const navOptions = useMemo(() => {
    const kw = navKw.trim().toLowerCase();
    if (!kw) return [];
    return navLeaves
      .filter((l) => l.group.toLowerCase().includes(kw) || l.label.toLowerCase().includes(kw))
      .slice(0, 10)
      .map((l) => ({ value: l.path, label: `${l.group} / ${l.label}` }));
  }, [navKw, navLeaves]);

  const menuItems: MenuProps["items"] = useMemo(
    () =>
      navTree.map((n) => ({
        key: n.key,
        icon: n.icon,
        label: n.label,
        children: n.children?.map((c) => ({ key: c.key, icon: c.icon, label: c.label })),
      })),
    [navTree]
  );

  // 当前路由选中项：叶子路径最长前缀匹配
  const selectedKey = useMemo(() => {
    let best = "";
    for (const l of navLeaves) {
      if (location.pathname.startsWith(l.path) && l.path.length > best.length) best = l.path;
    }
    return best || "/dashboard";
  }, [navLeaves, location.pathname]);

  // 当前路由所属分类 key（移动端只展开当前分类，避免全部分类铺开）
  const currentGroupKey = useMemo(() => {
    const hit = navTree.find((g) => containsNavKey(g, selectedKey));
    return hit?.key;
  }, [navTree, selectedKey]);

  // 菜单展开状态（受控）：桌面默认全部分类展开（原设计）；移动端只展开当前分类，
  // 路径切换时跟随（收起侧栏再展开不会回到"全部展开"）
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const isNarrow = typeof window !== "undefined" && window.innerWidth <= 992;
    if (isNarrow && currentGroupKey) return [currentGroupKey];
    return navTree.map((g) => g.key);
  });

  useEffect(() => {
    if (window.innerWidth <= 992 && currentGroupKey) {
      setOpenKeys((prev) => (prev.includes(currentGroupKey) ? prev : [...prev, currentGroupKey]));
    }
  }, [currentGroupKey]);

  /** 平板/窄窗（≤992px）：跳转后自动收起侧栏，避免展开态遮住目标页面。 */
  function collapseOnMobile() {
    if (window.innerWidth <= 992) setCollapsed(true);
  }

  // 导航"全部展开/全部收缩"：menuItems 已按权限过滤，以其分类 key 集合为准
  const menuGroupKeys = useMemo(() => menuItems.map((i) => String(i?.key)), [menuItems]);
  const allExpanded = menuGroupKeys.length > 0 && menuGroupKeys.every((k) => openKeys.includes(k));
  function toggleAllGroups() {
    setOpenKeys(allExpanded ? [] : menuGroupKeys);
  }

  return (
    <>
      <Layout style={{ height: "100dvh", overflow: "hidden" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={232}
        collapsedWidth={64}
        theme="light"
        style={{ height: "100dvh", overflow: "hidden", borderRight: `1px solid #E4EAF6`, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", boxShadow: "2px 0 12px rgba(30,36,51,.04)" }}
      >
        <div style={{ height: 60, display: "flex", alignItems: "center", gap: 10, padding: "0 16px" }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              background: "linear-gradient(135deg, #5B7FFF 0%, #7C93FF 100%)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: "0 4px 12px rgba(91,127,255,.35)",
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
        {!collapsed && (
          <div style={{ padding: "4px 12px 8px" }}>
            <AutoComplete
              style={{ width: "100%" }}
              value={navKw}
              options={navOptions}
              onChange={setNavKw}
              onSelect={(v) => {
                navigate(v);
                setNavKw("");
                collapseOnMobile();
              }}
              placeholder="搜索导航…"
              allowClear
            />
            <Button
              type="text"
              block
              icon={allExpanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              style={{ marginTop: 8, justifyContent: "flex-start", paddingLeft: 12, color: token.colorTextSecondary }}
              onClick={toggleAllGroups}
            >
              {allExpanded ? "全部收缩" : "全部展开"}
            </Button>
          </div>
        )}
        <Menu
          mode="inline"
          items={menuItems}
          openKeys={openKeys}
          onOpenChange={setOpenKeys}
          selectedKeys={[selectedKey]}
          onClick={({ key }) => {
            navigate(key);
            collapseOnMobile();
            // 点击侧边导航：无论是否同一页面都回到顶端
            scrollContentTop();
          }}
          style={{ borderInlineEnd: "none", padding: "8px 0" }}
        />
      </Sider>
      <Layout style={{ height: "100dvh", overflow: "hidden" }}>
        <Header
          style={{
            height: 60,
            flexShrink: 0,
            padding: "0 20px",
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(8px)",
            borderBottom: `1px solid ${token.colorBorder}`,
            display: "flex",
            alignItems: "center",
            gap: 16,
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
          {/* 顶栏面包屑：当前页面名（页面内 h2 为视觉主标题，避免两处大标题重复） */}
          <div style={{ fontSize: 14, whiteSpace: "nowrap" }}>
            <span style={{ color: token.colorTextTertiary }}>物料通</span>
            <span style={{ margin: "0 8px", color: token.colorTextQuaternary }}>/</span>
            <span style={{ color: token.colorText, fontWeight: 500 }}>{navLeaves.find((l) => l.path === selectedKey)?.label ?? TITLES[selectedKey] ?? "工作台"}</span>
          </div>
          <Input.Search
            placeholder="搜索材料 / 单号 / 条码…"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => {
              navigate(`/stock?keyword=${encodeURIComponent(v)}`);
              collapseOnMobile();
            }}
            style={{ width: 260, marginLeft: 8 }}
          />
          <div style={{ flex: 1 }} />
          <Badge count={unread} size="small">
            <Button type="text" icon={<BellOutlined style={{ fontSize: 17 }} />} onClick={() => setNoticeOpen(true)} />
          </Badge>
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
            <div className="wlt-user-chip" style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: "4px 10px", borderRadius: 999, border: `1px solid ${token.colorBorder}`, background: token.colorBgContainer }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#5B7FFF,#7C93FF)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600 }}>
                {(user?.real_name ?? "用")[0]}
              </div>
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.real_name}</div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{user?.role?.name ?? ""}</div>
              </div>
            </div>
          </Dropdown>
        </Header>
        <Content ref={contentRef} style={{ background: token.colorBgLayout, overflow: "auto", flex: 1, minHeight: 0 }}>
          {children}
        </Content>
      </Layout>
    </Layout>

    <Drawer
      title="通知中心"
      width={440}
      open={noticeOpen}
      onClose={() => setNoticeOpen(false)}
      destroyOnHidden
    >
      <Tabs
        activeKey={noticeTab}
        onChange={(k) => {
          setNoticeTab(k as "unread" | "all");
          setNoticeSelected(new Set());
        }}
        items={[
          { key: "unread", label: `未读${unread > 0 ? `（${unread}）` : ""}` },
          { key: "all", label: "全部" },
        ]}
      />
      {/* 工具栏（右对齐）：全部已读 / 删除选中 / 清空全部 统一靠右（与手机端行为一致） */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 2px 10px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={toggleSelectAll}>
          <Checkbox checked={allSelected} />
          <span style={{ fontSize: 13 }}>全选</span>
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>已选 {noticeSelected.size} 条</span>
        <Button type="link" size="small" onClick={() => {
          notificationApi.markReadAll().then(() => {
            setUnread(0);
            setNotices((ns) => ns.map((n) => ({ ...n, is_read: 1 })));
          }).catch(() => undefined);
        }}>
          全部已读
        </Button>
        <Button size="small" danger disabled={noticeSelected.size === 0} onClick={() => void deleteSelectedNotices()}>
          删除选中（{noticeSelected.size}）
        </Button>
        <Button size="small" onClick={() => void clearAllNotices()}>
          清空全部
        </Button>
      </div>
      <div style={{ minHeight: 320 }}>
        {noticeLoading && (
          <div style={{ padding: 60, textAlign: "center" }}>
            <Spin />
          </div>
        )}
        {!noticeLoading && notices.length === 0 && <Empty style={{ padding: "48px 0" }} description="暂无通知" />}
        {!noticeLoading &&
          notices.map((n) => {
            const style = BIZ_STYLE[n.biz_type] ?? { text: n.biz_type, color: "default" };
            return (
              <div
                key={n.id}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 2px",
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  background: noticeSelected.has(n.id) ? "rgba(22,119,255,.06)" : undefined,
                }}
              >
                <Checkbox checked={noticeSelected.has(n.id)} onChange={() => toggleNoticeSelect(n.id)} style={{ paddingTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onNoticeClick(n)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: n.is_read ? 400 : 600, fontSize: 13.5 }}>{n.title}</span>
                    <Tag color={style.color} style={{ marginInlineEnd: 0 }}>
                      {style.text}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 3, lineHeight: 1.5, wordBreak: "break-all" }}>{n.content}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                      {n.created_at.slice(0, 16)}
                      {desktopLink(n.link) ? " · 点击查看详情" : ""}
                    </span>
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      {!n.is_read && (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, fontSize: 12 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            notificationApi
                              .markRead(n.id)
                              .then(() => {
                                setNotices((ns) => ns.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
                                refreshUnread();
                              })
                              .catch(() => undefined);
                          }}
                        >
                          标记已读
                        </Button>
                      )}
                      <Popconfirm
                        title="删除该通知？"
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        cancelText="取消"
                        onConfirm={() => void removeOneNotice(n)}
                      >
                        <Button type="link" size="small" style={{ padding: 0, fontSize: 12, color: token.colorError }} onClick={(e) => e.stopPropagation()}>
                          删除
                        </Button>
                      </Popconfirm>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </Drawer>

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
