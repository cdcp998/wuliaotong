import { DotLoading, unstableSetRender } from "antd-mobile";
import React, { lazy, Suspense } from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";

// 电脑/宽屏浏览器（≥768px）打开移动端时的「应用窗口化」适配（限宽居中+弹层限宽）
import "./styles/widescreen.css";
// 全局基础样式（字体栈/焦点环/宫格按压反馈，见《UI设计方案.md》§2 设计系统）
import "./styles/global.css";

import { RequireAuth } from "./components/RequireAuth";
import { TabLayout } from "./components/TabLayout";
// 页面按路由懒加载：首屏只加载当前 Tab 所需代码
const CheckRunPage = lazy(() => import("./pages/CheckRun").then((m) => ({ default: m.CheckRunPage })));
const ChecksPage = lazy(() => import("./pages/Checks").then((m) => ({ default: m.ChecksPage })));
const FunctionsPage = lazy(() => import("./pages/Functions").then((m) => ({ default: m.FunctionsPage })));
const HomePage = lazy(() => import("./pages/Home").then((m) => ({ default: m.HomePage })));
const InboundPage = lazy(() => import("./pages/Inbound").then((m) => ({ default: m.InboundPage })));
const LoginPage = lazy(() => import("./pages/Login").then((m) => ({ default: m.LoginPage })));
const MinePage = lazy(() => import("./pages/Mine").then((m) => ({ default: m.MinePage })));
const MyRequisitionsPage = lazy(() => import("./pages/MyRequisitions").then((m) => ({ default: m.MyRequisitionsPage })));
const NotificationsPage = lazy(() => import("./pages/Notifications").then((m) => ({ default: m.NotificationsPage })));
const OcrScanPage = lazy(() => import("./pages/OcrScan").then((m) => ({ default: m.OcrScanPage })));
const OutboundPage = lazy(() => import("./pages/Outbound").then((m) => ({ default: m.OutboundPage })));
const RequisitionDetailPage = lazy(() => import("./pages/RequisitionDetail").then((m) => ({ default: m.RequisitionDetailPage })));
const RequisitionNewPage = lazy(() => import("./pages/RequisitionNew").then((m) => ({ default: m.RequisitionNewPage })));
const RequisitionAuditPage = lazy(() => import("./pages/RequisitionAudit").then((m) => ({ default: m.RequisitionAuditPage })));
const StockQueryPage = lazy(() => import("./pages/StockQuery").then((m) => ({ default: m.StockQueryPage })));
const TransfersPage = lazy(() => import("./pages/Transfers").then((m) => ({ default: m.TransfersPage })));
const WarehousesPage = lazy(() => import("./pages/Warehouses").then((m) => ({ default: m.WarehousesPage })));

/** TabBar 五页：首页/功能/领用/通知/我的（《UI设计方案.md》§3.3）。
 * 生产环境经 Nginx 反代部署在 /m/ 前缀（入口后缀），路由 basename=/m/ 后
 * 应用内跳转不再拼接前缀，刷新/直达 /m/xxx 均正常；开发环境无前缀。 */
const tabRouter = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    {
      element: (
        <RequireAuth>
          <TabLayout />
        </RequireAuth>
      ),
      children: [
        { path: "/", element: <HomePage /> },
        { path: "/functions", element: <FunctionsPage /> },
        { path: "/ocr/scan", element: <RequireAuth perm="ocr:use"><OcrScanPage /></RequireAuth> },
        { path: "/requisitions/new", element: <RequireAuth perm="req:apply"><RequisitionNewPage /></RequireAuth> },
        { path: "/notifications", element: <NotificationsPage /> },
        { path: "/mine", element: <MinePage /> },
      ],
    },
    // 二级页面（带返回 NavBar；perm 逗号分隔=任一命中）
    { path: "/requisitions/list", element: <RequireAuth perm="req:apply"><MyRequisitionsPage /></RequireAuth> },
    { path: "/requisitions/:id", element: <RequireAuth perm="req:apply,req:audit"><RequisitionDetailPage /></RequireAuth> },
    { path: "/requisitions/audit", element: <RequireAuth perm="req:audit"><RequisitionAuditPage /></RequireAuth> },
    { path: "/stock/query", element: <RequireAuth perm="stk:query"><StockQueryPage /></RequireAuth> },
    { path: "/warehouses", element: <RequireAuth perm="base:warehouse"><WarehousesPage /></RequireAuth> },
    { path: "/transfers", element: <RequireAuth perm="stk:transfer"><TransfersPage /></RequireAuth> },
    { path: "/inbound", element: <RequireAuth perm="pch:in"><InboundPage /></RequireAuth> },
    { path: "/outbound", element: <RequireAuth perm="stk:other"><OutboundPage /></RequireAuth> },
    { path: "/checks", element: <RequireAuth perm="stk:check"><ChecksPage /></RequireAuth> },
    { path: "/checks/:id", element: <RequireAuth perm="stk:check"><CheckRunPage /></RequireAuth> },
  ],
  // v7 future flags：react-router 6.30.4 运行时支持 v7_startTransition（类型声明滞后，故断言）；消除 v7 迁移警告
  { basename: import.meta.env.DEV ? "" : "/m/", future: { v7_startTransition: true, v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true } as Record<string, boolean> }
);

// antd-mobile v5 命令式弹层（Toast/Dialog 等）默认走 ReactDOM.render，React 19 已移除该 API；
// 官方兼容方案（mobile.ant.design/guide/v5-for-19）：注册 createRoot 渲染器，
// 否则每次弹层自动关闭都会报 unmountComponentAtNode is not a function。
unstableSetRender((node, container) => {
  const el = container as HTMLElement & { _reactRoot?: Root };
  el._reactRoot = el._reactRoot ?? ReactDOM.createRoot(el);
  el._reactRoot.render(node);
  return async () => {
    el._reactRoot?.unmount();
  };
});

function PageLoading() {
  return <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", color: "#646a73" }}><DotLoading /></div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* 品牌主色（《UI设计方案.md》§2.1）：antd-mobile 通过 CSS 变量换肤 */}
    <style>{`:root{--adm-color-primary:#1668dc;--adm-color-success:#52c41a;--adm-color-warning:#faad14;--adm-color-danger:#ff4d4f}`}</style>
    <Suspense fallback={<PageLoading />}>
      <RouterProvider router={tabRouter} />
    </Suspense>
  </React.StrictMode>
);
