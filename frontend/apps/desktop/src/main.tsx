import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter, Navigate } from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./components/RequireAuth";
import { AiSuggestionsPage } from "./pages/AiSuggestions";
import { BackupsPage } from "./pages/Backups";
import { CheckDetailPage } from "./pages/CheckDetail";
import { ChecksPage } from "./pages/Checks";
import { DashboardPage } from "./pages/Dashboard";
import { DeliveryOcrPage } from "./pages/DeliveryOcr";
import { DepartmentsPage } from "./pages/Departments";
import { LandingPage } from "./pages/Landing";
import { LogsPage } from "./pages/Logs";
import { LoginPage } from "./pages/Login";
import { OtherIoPage } from "./pages/OtherIo";
import { PurchaseInPage } from "./pages/PurchaseIn";
import { RegisterAppliesPage } from "./pages/RegisterApplies";
import { ReportsPage } from "./pages/Reports";
import { RequisitionAuditPage } from "./pages/RequisitionAudit";
import { RolesPage } from "./pages/Roles";
import { SettingsPage } from "./pages/Settings";
import { ShelfMapPage } from "./pages/ShelfMap";
import { StockQueryPage } from "./pages/StockQuery";
import { TransfersPage } from "./pages/Transfers";
import { UsersPage } from "./pages/Users";
import { WarehousesPage } from "./pages/Warehouses";

/** 受保护页面统一套上应用骨架（侧边导航 + 顶栏）。 */
function withLayout(page: React.ReactNode) {
  return <RequireAuth><AppLayout>{page}</AppLayout></RequireAuth>;
}

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> }, // 入口：设备识别自动跳转 + 手动选择
  { path: "/m/*", element: <Navigate to="/" replace /> }, // 手机版入口后缀误入电脑端时回入口
  { path: "/login", element: <LoginPage /> },
  { path: "/app", element: <Navigate to="/dashboard" replace /> }, // 工作台即经营看板
  { path: "/dashboard", element: withLayout(<DashboardPage />) },
  { path: "/reports", element: withLayout(<ReportsPage />) },
  { path: "/warehouses", element: withLayout(<WarehousesPage />) },
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
  { path: "/purchase-in", element: withLayout(<PurchaseInPage />) },
  { path: "/stock", element: withLayout(<StockQueryPage />) },
  { path: "/requisitions", element: withLayout(<RequisitionAuditPage />) },
  { path: "/ocr/delivery", element: withLayout(<DeliveryOcrPage />) },
  { path: "/ai-suggestions", element: withLayout(<AiSuggestionsPage />) },
]);

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
