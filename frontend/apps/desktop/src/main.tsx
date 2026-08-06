import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import { RequireAuth } from "./components/RequireAuth";
import { AiSuggestionsPage } from "./pages/AiSuggestions";
import { BackupsPage } from "./pages/Backups";
import { CheckDetailPage } from "./pages/CheckDetail";
import { ChecksPage } from "./pages/Checks";
import { DashboardPage } from "./pages/Dashboard";
import { DeliveryOcrPage } from "./pages/DeliveryOcr";
import { HomePage } from "./pages/Home";
import { LandingPage } from "./pages/Landing";
import { LogsPage } from "./pages/Logs";
import { LoginPage } from "./pages/Login";
import { OtherIoPage } from "./pages/OtherIo";
import { PurchaseInPage } from "./pages/PurchaseIn";
import { ReportsPage } from "./pages/Reports";
import { RolesPage } from "./pages/Roles";
import { SettingsPage } from "./pages/Settings";
import { ShelfMapPage } from "./pages/ShelfMap";
import { TransfersPage } from "./pages/Transfers";
import { UsersPage } from "./pages/Users";
import { WarehousesPage } from "./pages/Warehouses";

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> }, // 入口：设备识别自动跳转 + 手动选择
  { path: "/login", element: <LoginPage /> },
  { path: "/app", element: <RequireAuth><HomePage /></RequireAuth> },
  { path: "/dashboard", element: <RequireAuth><DashboardPage /></RequireAuth> },
  { path: "/reports", element: <RequireAuth><ReportsPage /></RequireAuth> },
  { path: "/warehouses", element: <RequireAuth><WarehousesPage /></RequireAuth> },
  { path: "/warehouses/:id/map", element: <RequireAuth><ShelfMapPage /></RequireAuth> },
  { path: "/system/settings", element: <RequireAuth><SettingsPage /></RequireAuth> },
  { path: "/system/users", element: <RequireAuth><UsersPage /></RequireAuth> },
  { path: "/system/roles", element: <RequireAuth><RolesPage /></RequireAuth> },
  { path: "/system/logs", element: <RequireAuth><LogsPage /></RequireAuth> },
  { path: "/system/backups", element: <RequireAuth><BackupsPage /></RequireAuth> },
  { path: "/transfers", element: <RequireAuth><TransfersPage /></RequireAuth> },
  { path: "/checks", element: <RequireAuth><ChecksPage /></RequireAuth> },
  { path: "/checks/:id", element: <RequireAuth><CheckDetailPage /></RequireAuth> },
  { path: "/other-io", element: <RequireAuth><OtherIoPage /></RequireAuth> },
  { path: "/purchase-in", element: <RequireAuth><PurchaseInPage /></RequireAuth> },
  { path: "/ocr/delivery", element: <RequireAuth><DeliveryOcrPage /></RequireAuth> },
  { path: "/ai-suggestions", element: <RequireAuth><AiSuggestionsPage /></RequireAuth> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
