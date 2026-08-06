import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

import { RequireAuth } from "./components/RequireAuth";
import { CheckRunPage } from "./pages/CheckRun";
import { ChecksPage } from "./pages/Checks";
import { HomePage } from "./pages/Home";
import { InboundPage } from "./pages/Inbound";
import { LoginPage } from "./pages/Login";
import { MyRequisitionsPage } from "./pages/MyRequisitions";
import { OcrScanPage } from "./pages/OcrScan";
import { OutboundPage } from "./pages/Outbound";
import { RequisitionNewPage } from "./pages/RequisitionNew";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <RequireAuth><HomePage /></RequireAuth> },
  { path: "/inbound", element: <RequireAuth><InboundPage /></RequireAuth> },
  { path: "/outbound", element: <RequireAuth><OutboundPage /></RequireAuth> },
  { path: "/checks", element: <RequireAuth><ChecksPage /></RequireAuth> },
  { path: "/checks/:id", element: <RequireAuth><CheckRunPage /></RequireAuth> },
  { path: "/requisitions/new", element: <RequireAuth><RequisitionNewPage /></RequireAuth> },
  { path: "/requisitions/list", element: <RequireAuth><MyRequisitionsPage /></RequireAuth> },
  { path: "/ocr/scan", element: <RequireAuth><OcrScanPage /></RequireAuth> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
