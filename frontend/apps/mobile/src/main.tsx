import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

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

/** TabBar 五页：首页/扫码/领用/通知/我的（《UI设计方案.md》§3.3）。
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
  { basename: import.meta.env.DEV ? "" : "/m/" }
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* 品牌主色（《UI设计方案.md》§2.1）：antd-mobile 通过 CSS 变量换肤 */}
    <style>{`:root{--adm-color-primary:#1668dc;--adm-color-success:#52c41a;--adm-color-warning:#faad14;--adm-color-danger:#ff4d4f}`}</style>
    <RouterProvider router={tabRouter} />
  </React.StrictMode>
);
