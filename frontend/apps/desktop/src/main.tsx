import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import { RequireAuth } from "./components/RequireAuth";
import { CheckDetailPage } from "./pages/CheckDetail";
import { ChecksPage } from "./pages/Checks";
import { HomePage } from "./pages/Home";
import { LandingPage } from "./pages/Landing";
import { LoginPage } from "./pages/Login";
import { OtherIoPage } from "./pages/OtherIo";
import { SettingsPage } from "./pages/Settings";
import { TransfersPage } from "./pages/Transfers";

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> }, // 入口：设备识别自动跳转 + 手动选择
  { path: "/login", element: <LoginPage /> },
  { path: "/app", element: <RequireAuth><HomePage /></RequireAuth> },
  { path: "/system/settings", element: <RequireAuth><SettingsPage /></RequireAuth> },
  { path: "/transfers", element: <RequireAuth><TransfersPage /></RequireAuth> },
  { path: "/checks", element: <RequireAuth><ChecksPage /></RequireAuth> },
  { path: "/checks/:id", element: <RequireAuth><CheckDetailPage /></RequireAuth> },
  { path: "/other-io", element: <RequireAuth><OtherIoPage /></RequireAuth> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
