import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter, Navigate } from "react-router";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./components/RequireAuth";
import { AiSuggestionsPage } from "./pages/AiSuggestions";
import { AiLogsPage } from "./pages/AiLogs";
import { BackupsPage } from "./pages/Backups";
import { CheckDetailPage } from "./pages/CheckDetail";
import { ChecksPage } from "./pages/Checks";
import { DashboardPage } from "./pages/Dashboard";
import { DeliveryOcrPage } from "./pages/DeliveryOcr";
import { DepartmentsPage } from "./pages/Departments";
import { HistoryPricePage } from "./pages/HistoryPrice";
import { InitPage } from "./pages/Init";
import { LandingPage } from "./pages/Landing";
import { LogsPage } from "./pages/Logs";
import { LoginPage } from "./pages/Login";
import { CategoriesPage } from "./pages/Categories";
import { MaterialsPage } from "./pages/Materials";
import { OtherIoPage } from "./pages/OtherIo";
import { PurchaseInPage } from "./pages/PurchaseIn";
import { RegisterAppliesPage } from "./pages/RegisterApplies";
import { ReportsPage } from "./pages/Reports";
import { RequisitionApplyPage } from "./pages/RequisitionApply";
import { RequisitionAuditPage } from "./pages/RequisitionAudit";
import { RequisitionQueryPage } from "./pages/RequisitionQuery";
import { RolesPage } from "./pages/Roles";
import { SettingsPage } from "./pages/Settings";
import { ShelfMapPage } from "./pages/ShelfMap";
import { StockQueryPage } from "./pages/StockQuery";
import { SuppliersPage } from "./pages/Suppliers";
import { TransfersPage } from "./pages/Transfers";
import { UnitsPage } from "./pages/Units";
import { UsersPage } from "./pages/Users";
import { WarehousesPage } from "./pages/Warehouses";

/** 受保护页面统一套上应用骨架（侧边导航 + 顶栏）。 */
function withLayout(page: React.ReactNode) {
  return <RequireAuth><AppLayout>{page}</AppLayout></RequireAuth>;
}

const router = createBrowserRouter(
  [
  { path: "/", element: <LandingPage /> }, // 入口：未初始化跳 /init，否则设备识别自动跳转 + 手动选择
  { path: "/init", element: <InitPage /> }, // 初始化安装页（未初始化时强制进入；已初始化自动跳回登录/主页）
  { path: "/m/*", element: <Navigate to="/" replace /> }, // 手机版入口后缀误入电脑端时回入口
  { path: "/login", element: <LoginPage /> },
  { path: "/app", element: <Navigate to="/dashboard" replace /> }, // 工作台即经营看板
  { path: "/dashboard", element: withLayout(<DashboardPage />) },
  { path: "/reports", element: withLayout(<ReportsPage />) },
  { path: "/warehouses", element: withLayout(<WarehousesPage />) },
  { path: "/materials", element: withLayout(<MaterialsPage />) },
  { path: "/categories", element: withLayout(<CategoriesPage />) },
  { path: "/suppliers", element: withLayout(<SuppliersPage />) },
  { path: "/units", element: withLayout(<UnitsPage />) },
  { path: "/warehouses/:id/map", element: withLayout(<ShelfMapPage />) },
  { path: "/system/settings", element: withLayout(<SettingsPage />) },
  { path: "/system/users", element: withLayout(<UsersPage />) },
  { path: "/system/roles", element: withLayout(<RolesPage />) },
  { path: "/system/logs", element: withLayout(<LogsPage />) },
  { path: "/system/backups", element: withLayout(<BackupsPage />) },
  { path: "/system/register-applies", element: withLayout(<RegisterAppliesPage />) },
  { path: "/system/departments", element: withLayout(<DepartmentsPage />) },
  { path: "/transfers", element: withLayout(<TransfersPage />) },
  { path: "/checks", element: withLayout(<ChecksPage />) },
  { path: "/checks/:id", element: withLayout(<CheckDetailPage />) },
  { path: "/other-io", element: withLayout(<OtherIoPage />) },
  { path: "/history-price", element: withLayout(<HistoryPricePage />) },
  { path: "/requisitions/apply", element: withLayout(<RequisitionApplyPage />) },
  { path: "/requisitions/query", element: withLayout(<RequisitionQueryPage />) },
  { path: "/requisitions", element: withLayout(<RequisitionAuditPage />) },
  { path: "/purchase-in", element: withLayout(<PurchaseInPage />) },
  { path: "/stock", element: withLayout(<StockQueryPage />) },
  { path: "/ocr/delivery", element: withLayout(<DeliveryOcrPage />) },
  { path: "/ai-suggestions", element: withLayout(<AiSuggestionsPage />) },
  { path: "/llm-logs", element: withLayout(<AiLogsPage />) },
  ],
  // v7 future flags：react-router 6.30.4 运行时支持 v7_startTransition（类型声明滞后，故断言）；消除 v7 迁移警告
  { future: { v7_startTransition: true, v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true } as Record<string, boolean> }
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#1668dc",
          colorBgLayout: "#f5f6f8",
          colorText: "#1f2329",
          colorTextSecondary: "#4e5969",
          borderRadius: 6,
          fontSize: 14,
        },
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
