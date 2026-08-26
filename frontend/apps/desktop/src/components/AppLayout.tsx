import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  App,
  AutoComplete,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Spin,
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

import {
  authApi,
  notificationApi,
  NOTICE_CAT_STYLE,
  NOTICE_DAY_GROUPS,
  NoticeCatIcon,
  NoticeCheckIcon,
  noticeCatOf,
  noticeDayKey,
  noticeRelTime,
  otherEndUrl,
  useAuthStore,
  type MenuNode,
  type NotificationItem,
} from "@wlt/shared";
import { useViewportTier } from "../hooks/useViewportTier";

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

/** 筛选胶囊（与手机端消息页一致，OP M7b）：全部 / 未读 n / 预警 / 待办 / 提醒——按 biz_type 语义分类前端过滤。 */
type NoticeFilterKey = "all" | "unread" | "warn" | "todo" | "remind";

const NOTICE_FILTERS: Array<{ key: NoticeFilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "warn", label: "预警" },
  { key: "todo", label: "待办" },
  { key: "remind", label: "提醒" },
];

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
  // 统一响应式断点：≥1024 桌面（左侧导航）/ 768~1023 平板 / <768 移动（主导航移到顶部横排）
  const tier = useViewportTier();
  const isDesktop = tier === "desktop";
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= 992);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 992px)");
    const onChange = () => setCollapsed((c) => (mq.matches ? c : false) as boolean);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [noticeOpen, setNoticeOpen] = useState(false); // 通知中心抽屉
  const [notices, setNotices] = useState<NotificationItem[]>([]);
  const [noticeFilter, setNoticeFilter] = useState<NoticeFilterKey>("all"); // 类型筛选胶囊（前端过滤）
  const [noticeManage, setNoticeManage] = useState(false); // 管理模式（勾选 + 删除，与手机端一致）
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

  /** 拉取通知列表：取最近 50 条，类型筛选与日期分组均在前端做（与手机端消息页一致）。 */
  const loadNotices = useCallback(() => {
    setNoticeLoading(true);
    notificationApi
      .list(undefined, 1, 50)
      .then((d) => setNotices(d.list))
      .catch(() => message.error("通知加载失败"))
      .finally(() => setNoticeLoading(false));
  }, [message]);

  /** 刷新未读徽标。 */
  const refreshUnread = useCallback(() => {
    notificationApi
      .unreadCount()
      .then((d) => setUnread(d.unread_count))
      .catch(() => undefined);
  }, []);

  // 打开抽屉即加载
  useEffect(() => {
    if (noticeOpen) {
      loadNotices();
      refreshUnread();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeOpen]);

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

  const unreadCount = useMemo(() => notices.filter((n) => !n.is_read).length, [notices]);

  /** 当前展示集合：管理模式强制全部（筛选行隐藏）；否则按筛选胶囊过滤。 */
  const visibleNotices = useMemo(() => {
    if (noticeManage || noticeFilter === "all") return notices;
    if (noticeFilter === "unread") return notices.filter((n) => !n.is_read);
    return notices.filter((n) => noticeCatOf(n.biz_type) === noticeFilter);
  }, [notices, noticeFilter, noticeManage]);

  /** 按今天/昨天/更早分组（保持接口返回的时间倒序），空组不显示。 */
  const noticeGroups = useMemo(
    () =>
      NOTICE_DAY_GROUPS.map((g) => ({ ...g, items: visibleNotices.filter((n) => noticeDayKey(n.created_at) === g.key) })).filter(
        (g) => g.items.length > 0
      ),
    [visibleNotices]
  );

  const allSelected = notices.length > 0 && noticeSelected.size === notices.length;

  /** 全部已读（抽屉头部与底部操作栏共用）。 */
  function markAllNotices() {
    notificationApi
      .markReadAll()
      .then(() => {
        setUnread(0);
        setNotices((ns) => ns.map((n) => ({ ...n, is_read: 1 })));
      })
      .catch(() => undefined);
  }

  /** 切换管理模式；退出时清空选择（与手机端一致）。 */
  function toggleNoticeManage() {
    setNoticeManage((v) => {
      const next = !v;
      if (!next) setNoticeSelected(new Set());
      return next;
    });
  }

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

  /** 方形勾选框（17×17 r5，OP Manage 样式）：管理模式行尾与「全选」共用。 */
  function SquareCheck({ checked }: { checked: boolean }) {
    return (
      <span
        style={{
          width: 17,
          height: 17,
          borderRadius: 5,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: checked ? "#3B5BDB" : "#fff",
          border: checked ? "1px solid #3B5BDB" : "1px solid #CBD6EC",
          boxSizing: "border-box",
          color: "#fff",
        }}
      >
        {checked && <NoticeCheckIcon />}
      </span>
    );
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
    // 折叠态（图标栏）：清空展开组，避免当前分组子菜单以浮层弹出盖住内容
    if (collapsed) {
      setOpenKeys([]);
      return;
    }
    if (window.innerWidth <= 992 && currentGroupKey) {
      setOpenKeys((prev) => (prev.includes(currentGroupKey) ? prev : [...prev, currentGroupKey]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroupKey, collapsed]);

  // 宽屏：动态菜单加载完成后补全新分组 key（默认全部展开，与设计稿「分组标题+扁平项」一致）；
  // 用户手动点「全部收缩」后不再强制展开
  useEffect(() => {
    if (window.innerWidth > 992 && !collapsed) {
      setOpenKeys(menuItems.map((i) => String(i?.key)).filter(Boolean));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItems]);

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
      {isDesktop && (
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={232}
        collapsedWidth={64}
        theme="light"
        style={{ height: "100dvh", overflow: "hidden", borderRight: `1px solid #E4EAF6`, background: "#FFFFFF", display: "flex", flexDirection: "column", cursor: collapsed ? "pointer" : undefined }}
        title={collapsed ? "点击展开侧边栏" : undefined}
        onClick={(e) => {
          // 收缩态点击空白处（非菜单项/按钮/链接）展开侧栏
          if (!collapsed) return;
          const t = e.target as HTMLElement;
          if (t.closest(".ant-menu-item, .ant-menu-submenu, button, a, input")) return;
          setCollapsed(false);
        }}
      >
        <div style={{ height: 60, display: "flex", alignItems: "center", gap: 10, padding: "0 14px" }}>
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
          <div style={{ padding: "0 12px 6px", flexShrink: 0 }}>
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
              size="small"
              icon={allExpanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              style={{ marginTop: 6, justifyContent: "flex-start", paddingLeft: 12, color: token.colorTextSecondary }}
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
          style={{ borderInlineEnd: "none", padding: "8px 0", flex: 1, minHeight: 0, overflowY: "auto" }}
        />
      </Sider>
      )}
      <Layout style={{ height: "100dvh", overflow: "hidden" }}>
        <Header
          style={{
            height: 60,
            flexShrink: 0,
            padding: "0 24px",
            background: "#FFFFFF",
            borderBottom: `1px solid #E4EAF6`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          {isDesktop && (
            <Button
              style={{ width: 34, height: 34, padding: 0, background: "#FFFFFF", border: `1px solid #E4EAF6`, borderRadius: 10, color: token.colorTextSecondary }}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
          )}
          {/* 顶栏面包屑：当前页面名（页面内 h2 为视觉主标题，避免两处大标题重复）；窄屏隐藏省空间 */}
          {tier !== "mobile" && (
            <div style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              <span style={{ color: token.colorTextTertiary }}>物料通</span>
              <span style={{ margin: "0 8px", color: "#CBD6EC" }}>/</span>
              <span style={{ color: "#1E2433", fontWeight: 600 }}>{navLeaves.find((l) => l.path === selectedKey)?.label ?? TITLES[selectedKey] ?? "工作台"}</span>
            </div>
          )}
          <Input.Search
            placeholder="搜索材料 / 单号 / 条码…"
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => {
              navigate(`/stock?keyword=${encodeURIComponent(v)}`);
              collapseOnMobile();
            }}
            style={{ width: tier === "desktop" ? 260 : tier === "tablet" ? 170 : 120, marginLeft: tier === "mobile" ? 0 : 8, background: "#FFFFFF", borderColor: "#CBD6EC" }}
          />
          <div style={{ flex: 1 }} />
          <Badge count={unread} size="small">
            <Button
              style={{ width: 34, height: 34, padding: 0, background: "#FFFFFF", border: `1px solid #E4EAF6`, borderRadius: 10, color: token.colorTextSecondary }}
              icon={<BellOutlined style={{ fontSize: 16 }} />}
              onClick={() => setNoticeOpen(true)}
            />
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
            <div className="wlt-user-chip" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "5px 10px", borderRadius: 999, background: "#F6F8FE" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#EAEFFF", color: "#3B5BDB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                {(user?.real_name ?? "用")[0]}
              </div>
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{user?.real_name}</div>
                <div style={{ fontSize: 10.5, color: token.colorTextTertiary }}>{user?.role?.name ?? ""}</div>
              </div>
            </div>
          </Dropdown>
        </Header>
        {/* 平板/移动（<1024）：主导航移到顶部，横排菜单（组渲染为下拉子菜单，溢出自动收进 …） */}
        {!isDesktop && (
          <div style={{ flexShrink: 0, background: "#FFFFFF", borderBottom: "1px solid #E4EAF6", padding: "0 8px" }}>
            <Menu
              mode="horizontal"
              items={menuItems}
              selectedKeys={[selectedKey]}
              onClick={({ key }) => {
                navigate(key);
                scrollContentTop();
              }}
              style={{ borderInlineEnd: "none", background: "transparent" }}
            />
          </div>
        )}
        <Content ref={contentRef} style={{ background: token.colorBgLayout, overflow: "auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {children}
        </Content>
      </Layout>
    </Layout>

    <Drawer
      title="消息"
      size={440}
      open={noticeOpen}
      onClose={() => setNoticeOpen(false)}
      destroyOnHidden
      styles={{ body: { background: "#F2F5FB", padding: "0 12px 12px", display: "flex", flexDirection: "column" } }}
      extra={
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {!noticeManage && (
            <span style={{ fontSize: 12, color: "#5B6478", cursor: "pointer" }} onClick={markAllNotices}>
              全部已读
            </span>
          )}
          <span style={{ fontSize: 12, fontWeight: 600, color: noticeManage ? "#DC2626" : "#5B7FFF", cursor: "pointer" }} onClick={toggleNoticeManage}>
            {noticeManage ? "完成" : "管理"}
          </span>
        </div>
      }
      footer={
        noticeManage ? (
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => void deleteSelectedNotices()}
              disabled={noticeSelected.size === 0}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 11,
                border: "none",
                background: "#FDEBEC",
                color: noticeSelected.size === 0 ? "#F0A6AA" : "#DC2626",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: noticeSelected.size === 0 ? "default" : "pointer",
              }}
            >
              删除选中（{noticeSelected.size}）
            </button>
            <button
              onClick={markAllNotices}
              style={{
                height: 36,
                borderRadius: 11,
                border: "1px solid #E4EAF6",
                background: "#fff",
                color: "#5B6478",
                fontSize: 12,
                fontWeight: 500,
                padding: "0 14px",
                cursor: "pointer",
              }}
            >
              全部已读
            </button>
          </div>
        ) : undefined
      }
    >
      {/* 类型筛选胶囊行（OP A FilterChips：全部(激活蓝底)/未读 n/预警/待办/提醒；管理模式隐藏） */}
      {!noticeManage && (
        <div style={{ display: "flex", gap: 8, padding: "2px 0 10px", flexWrap: "wrap" }}>
          {NOTICE_FILTERS.map((f) => {
            const active = noticeFilter === f.key;
            return (
              <span
                key={f.key}
                onClick={() => setNoticeFilter(f.key)}
                style={{
                  borderRadius: 999,
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: active ? "#5B7FFF" : "#fff",
                  border: `1px solid ${active ? "#5B7FFF" : "#E4EAF6"}`,
                  color: active ? "#fff" : "#5B6478",
                }}
              >
                {f.label}
                {f.key === "unread" && unreadCount > 0 && (
                  <b style={{ fontSize: 11, fontWeight: 700, color: active ? "#DDE6FF" : "#5B7FFF" }}>{unreadCount}</b>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* 管理模式条（OP B Manage：方形勾选+全选 | 已选 n 条 · 清空全部） */}
      {noticeManage && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 2px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }} onClick={toggleSelectAll}>
            <SquareCheck checked={allSelected} />
            <span style={{ fontSize: 12, fontWeight: 500, color: "#5B6478" }}>全选</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: "#8A93A8" }}>已选 {noticeSelected.size} 条</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#DC2626", cursor: "pointer" }} onClick={() => void clearAllNotices()}>
              清空全部
            </span>
          </div>
        </div>
      )}

      {/* 分组通知流（OP NRow r14 p12 gap10：图标块 + 标题[未读尾随蓝点] + 内容 + 胶囊·相对时间；
          未读=#EAEFFF / 已读=白底 #EDF1FA 描边 / 选中=#D9E3FF；点击行=标记已读+联动跳转，删除走管理模式） */}
      <div style={{ flex: 1, minHeight: 320, display: "flex", flexDirection: "column", gap: 8 }}>
        {noticeLoading && (
          <div style={{ padding: 60, textAlign: "center" }}>
            <Spin />
          </div>
        )}
        {!noticeLoading && notices.length > 0 && noticeGroups.length === 0 && (
          <div style={{ textAlign: "center", color: "#8A93A8", fontSize: 13, padding: "48px 0" }}>该分类下暂无通知</div>
        )}
        {!noticeLoading && notices.length === 0 && (
          <div style={{ textAlign: "center", color: "#8A93A8", fontSize: 13, padding: "48px 0" }}>暂无通知</div>
        )}
        {!noticeLoading &&
          noticeGroups.map((g) => (
            <Fragment key={g.key}>
              <div style={{ padding: "6px 2px", fontSize: 11, fontWeight: 600, color: "#8A93A8" }}>{g.label}</div>
              {g.items.map((n) => {
                const cat = noticeCatOf(n.biz_type);
                const st = NOTICE_CAT_STYLE[cat];
                const checked = noticeSelected.has(n.id);
                const unread = !n.is_read;
                return (
                  <div
                    key={n.id}
                    onClick={() => onNoticeClick(n)}
                    style={{
                      borderRadius: 14,
                      padding: 12,
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      cursor: "pointer",
                      background: checked ? "#D9E3FF" : unread ? "#EAEFFF" : "#fff",
                      border: checked || unread ? "none" : "1px solid #EDF1FA",
                    }}
                  >
                    {/* 左侧类型图标块（30×30 r9 浅底 + 线性图标） */}
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        background: st.tileBg,
                        color: st.tileFg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <NoticeCatIcon cat={cat} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: unread ? 600 : 500, color: "#1E2433", lineHeight: 1.45 }}>
                          {n.title}
                        </span>
                        {unread && !noticeManage && <span style={{ width: 7, height: 7, borderRadius: 4, background: "#5B7FFF", flexShrink: 0 }} />}
                      </div>
                      <div style={{ fontSize: 12, color: "#5B6478", lineHeight: 1.5, wordBreak: "break-all" }}>{n.content}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: 999,
                            padding: "1px 9px",
                            fontSize: 11,
                            fontWeight: 600,
                            lineHeight: "16px",
                            whiteSpace: "nowrap",
                            background: st.pillBg,
                            color: st.pillFg,
                          }}
                        >
                          {n.biz_type || "通知"}
                        </span>
                        <span style={{ fontSize: 11, color: "#8A93A8" }}>{noticeRelTime(n.created_at)}</span>
                        {desktopLink(n.link) ? <span style={{ fontSize: 11, color: "#8A93A8" }}>· 点击查看详情</span> : null}
                      </div>
                    </div>
                    {/* 管理模式行尾勾选框 */}
                    {noticeManage && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleNoticeSelect(n.id);
                        }}
                      >
                        <SquareCheck checked={checked} />
                      </span>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
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
      destroyOnHidden forceRender
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
