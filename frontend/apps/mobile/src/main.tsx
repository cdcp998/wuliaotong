import { unstableSetRender } from "antd-mobile";
import React from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";

import { RequireAuth } from "./components/RequireAuth";
import { TabLayout } from "./components/TabLayout";
import { CheckRunPage } from "./pages/CheckRun";
import { ChecksPage } from "./pages/Checks";
import { HomePage } from "./pages/Home";
import { InboundPage } from "./pages/Inbound";
import { LoginPage } from "./pages/Login";
import { MinePage } from "./pages/Mine";
import { MyRequisitionsPage } from "./pages/MyRequisitions";
import { NotificationsPage } from "./pages/Notifications";
import { OcrScanPage } from "./pages/OcrScan";
import { OutboundPage } from "./pages/Outbound";
import { RequisitionDetailPage } from "./pages/RequisitionDetail";
import { RequisitionNewPage } from "./pages/RequisitionNew";
import { StockQueryPage } from "./pages/StockQuery";

/** TabBar 五页：首页/识别/领用/通知/我的（《UI设计方案.md》§3.3）。
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
        { path: "/ocr/scan", element: <OcrScanPage /> },
        { path: "/requisitions/new", element: <RequisitionNewPage /> },
        { path: "/notifications", element: <NotificationsPage /> },
        { path: "/mine", element: <MinePage /> },
      ],
    },
    // 二级页面（带返回 NavBar）
    { path: "/requisitions/list", element: <RequireAuth><MyRequisitionsPage /></RequireAuth> },
    { path: "/requisitions/:id", element: <RequireAuth><RequisitionDetailPage /></RequireAuth> },
    { path: "/stock/query", element: <RequireAuth><StockQueryPage /></RequireAuth> },
    { path: "/inbound", element: <RequireAuth><InboundPage /></RequireAuth> },
    { path: "/outbound", element: <RequireAuth><OutboundPage /></RequireAuth> },
    { path: "/checks", element: <RequireAuth><ChecksPage /></RequireAuth> },
    { path: "/checks/:id", element: <RequireAuth><CheckRunPage /></RequireAuth> },
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* 品牌主色（《UI设计方案.md》§2.1）：antd-mobile 通过 CSS 变量换肤 */}
    <style>{`:root{--adm-color-primary:#1668dc;--adm-color-success:#52c41a;--adm-color-warning:#faad14;--adm-color-danger:#ff4d4f}`}</style>
    <RouterProvider router={tabRouter} />
  </React.StrictMode>
);
