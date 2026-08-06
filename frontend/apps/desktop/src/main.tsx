import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import { RequireAuth } from "./components/RequireAuth";
import { HomePage } from "./pages/Home";
import { LandingPage } from "./pages/Landing";
import { LoginPage } from "./pages/Login";

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> }, // 入口：设备识别自动跳转 + 手动选择
  { path: "/login", element: <LoginPage /> },
  {
    path: "/app",
    element: (
      <RequireAuth>
        <HomePage />
      </RequireAuth>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
