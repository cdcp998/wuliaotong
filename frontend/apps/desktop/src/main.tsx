import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter, Navigate, useLocation } from "react-router";
import { App as AntApp, ConfigProvider, Spin } from "antd";
import zhCN from "antd/locale/zh_CN";

// 全局基础样式（字体栈/标题层级/焦点环/数字排版，见《UI设计方案.md》§2 设计系统）
import "./styles/global.css";
// 移动端适配（响应式）样式：全部规则位于 @media 内，桌面宽度下不生效（《前端设计.md》§2.3）
import "./mobile.css";

import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./components/RequireAuth";
import { RequireModule } from "./components/RequireModule";
// 页面全部按路由懒加载：首屏不再打包全部页面（此前单 chunk >1.6MB）
const AiSuggestionsPage = lazy(() => import("./pages/AiSuggestions").then((m) => ({ default: m.AiSuggestionsPage })));
const AiLogsPage = lazy(() => import("./pages/AiLogs").then((m) => ({ default: m.AiLogsPage })));
const BackupsPage = lazy(() => import("./pages/Backups").then((m) => ({ default: m.BackupsPage })));
const CheckDetailPage = lazy(() => import("./pages/CheckDetail").then((m) => ({ default: m.CheckDetailPage })));
const ChecksPage = lazy(() => import("./pages/Checks").then((m) => ({ default: m.ChecksPage })));
const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const DeliveryOcrPage = lazy(() => import("./pages/DeliveryOcr").then((m) => ({ default: m.DeliveryOcrPage })));
const DepartmentsPage = lazy(() => import("./pages/Departments").then((m) => ({ default: m.DepartmentsPage })));
const HistoryPricePage = lazy(() => import("./pages/HistoryPrice").then((m) => ({ default: m.HistoryPricePage })));
const InitPage = lazy(() => import("./pages/Init").then((m) => ({ default: m.InitPage })));
const LandingPage = lazy(() => import("./pages/Landing").then((m) => ({ default: m.LandingPage })));
const LogsPage = lazy(() => import("./pages/Logs").then((m) => ({ default: m.LogsPage })));
const MenusPage = lazy(() => import("./pages/Menus").then((m) => ({ default: m.MenusPage })));
const ModulesPage = lazy(() => import("./pages/Modules").then((m) => ({ default: m.ModulesPage })));
const LoginPage = lazy(() => import("./pages/Login").then((m) => ({ default: m.LoginPage })));
const MaterialsDataPage = lazy(() => import("./pages/MaterialsData").then((m) => ({ default: m.MaterialsDataPage })));
const DeleteReviewsPage = lazy(() => import("./pages/DeleteReviews").then((m) => ({ default: m.DeleteReviewsPage })));
const OtherIoPage = lazy(() => import("./pages/OtherIo").then((m) => ({ default: m.OtherIoPage })));
const PurchaseInPage = lazy(() => import("./pages/PurchaseIn").then((m) => ({ default: m.PurchaseInPage })));
const PurchasePlansPage = lazy(() => import("./pages/PurchasePlans").then((m) => ({ default: m.PurchasePlansPage })));
const RegisterAppliesPage = lazy(() => import("./pages/RegisterApplies").then((m) => ({ default: m.RegisterAppliesPage })));
const ReportsPage = lazy(() => import("./pages/Reports").then((m) => ({ default: m.ReportsPage })));
const RequisitionApplyPage = lazy(() => import("./pages/RequisitionApply").then((m) => ({ default: m.RequisitionApplyPage })));
const RequisitionAuditPage = lazy(() => import("./pages/RequisitionAudit").then((m) => ({ default: m.RequisitionAuditPage })));
const RequisitionQueryPage = lazy(() => import("./pages/RequisitionQuery").then((m) => ({ default: m.RequisitionQueryPage })));
const RolesPage = lazy(() => import("./pages/Roles").then((m) => ({ default: m.RolesPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const StockQueryPage = lazy(() => import("./pages/StockQuery").then((m) => ({ default: m.StockQueryPage })));
const SuppliersPage = lazy(() => import("./pages/Suppliers").then((m) => ({ default: m.SuppliersPage })));
const TransfersPage = lazy(() => import("./pages/Transfers").then((m) => ({ default: m.TransfersPage })));
const UnitsPage = lazy(() => import("./pages/Units").then((m) => ({ default: m.UnitsPage })));
const UsersPage = lazy(() => import("./pages/Users").then((m) => ({ default: m.UsersPage })));
const WarehousesPage = lazy(() => import("./pages/Warehouses").then((m) => ({ default: m.WarehousesPage })));
// cable 模块页面（模块插件，方案 §2.3：apps/desktop/src/modules/{code}/）
const CableMapPage = lazy(() => import("./modules/cable/CableMap").then((m) => ({ default: m.CableMapPage })));
const CableListPage = lazy(() => import("./modules/cable/CableList").then((m) => ({ default: m.CableListPage })));
const CableFaultsPage = lazy(() => import("./modules/cable/CableFaults").then((m) => ({ default: m.CableFaultsPage })));
// task 模块页面
const TaskBoardPage = lazy(() => import("./modules/task/TaskBoard").then((m) => ({ default: m.TaskBoardPage })));
const TaskListPage = lazy(() => import("./modules/task/TaskList").then((m) => ({ default: m.TaskListPage })));
// knowledge 模块页面
const KnowledgePage = lazy(() => import("./modules/knowledge/Knowledge").then((m) => ({ default: m.KnowledgePage })));
const KnowledgeWritePage = lazy(() => import("./modules/knowledge/KnowledgeWrite").then((m) => ({ default: m.KnowledgeWritePage })));
// device 模块页面
const DeviceListPage = lazy(() => import("./modules/device/DeviceList").then((m) => ({ default: m.DeviceListPage })));
const DeviceTasksPage = lazy(() => import("./modules/device/DeviceTasks").then((m) => ({ default: m.DeviceTasksPage })));

/** 路由懒加载的统一 Loading 占位。 */
function PageLoading() {
  return <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}><Spin size="large" /></div>;
}

/** 页面进场动画包装：key=location.pathname，路由切换即重挂载，覆盖全部受保护业务页。
 * 置于 Suspense 边界内：懒加载 chunk 未就绪时先显示 Loading，就绪后 PageShell+页面一起进场动画。 */
function PageShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="wlt-page">
      {children}
    </div>
  );
}

/** 受保护页面统一套上应用骨架（侧边导航 + 顶栏）。 */
function withLayout(page: React.ReactNode) {
  return (
    <RequireAuth>
      <AppLayout>
        <Suspense fallback={<PageLoading />}>
          <PageShell>{page}</PageShell>
        </Suspense>
      </AppLayout>
    </RequireAuth>
  );
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
  { path: "/materials-data", element: withLayout(<MaterialsDataPage />) },
  { path: "/delete-reviews", element: withLayout(<DeleteReviewsPage />) },
  // 旧路由兼容：材料管理 / 分类管理 已合并为「物料数据管理」，重定向到新页
  { path: "/materials", element: <Navigate to="/materials-data" replace /> },
  { path: "/categories", element: <Navigate to="/materials-data" replace /> },
  { path: "/suppliers", element: withLayout(<SuppliersPage />) },
  { path: "/units", element: withLayout(<UnitsPage />) },
  // 旧 2D 货架图已并入「仓库与货架」内嵌 2.5D 视图，旧地址重定向
  { path: "/warehouses/:id/map", element: <Navigate to="/warehouses" replace /> },
  { path: "/system/settings", element: withLayout(<SettingsPage />) },
  { path: "/system/users", element: withLayout(<UsersPage />) },
  { path: "/system/roles", element: withLayout(<RolesPage />) },
  { path: "/system/menus", element: withLayout(<MenusPage />) },
  { path: "/system/modules", element: withLayout(<ModulesPage />) },
  // cable 模块（RequireModule：模块未启用时渲染占位；权限由菜单 perm_code 联动）
  { path: "/cable/map", element: withLayout(<RequireModule code="cable"><CableMapPage /></RequireModule>) },
  { path: "/cable/list", element: withLayout(<RequireModule code="cable"><CableListPage /></RequireModule>) },
  { path: "/cable/faults", element: withLayout(<RequireModule code="cable"><CableFaultsPage /></RequireModule>) },
  // task 模块
  { path: "/task/board", element: withLayout(<RequireModule code="task"><TaskBoardPage /></RequireModule>) },
  { path: "/task/list", element: withLayout(<RequireModule code="task"><TaskListPage /></RequireModule>) },
  // knowledge 模块
  { path: "/knowledge", element: withLayout(<RequireModule code="knowledge"><KnowledgePage /></RequireModule>) },
  { path: "/knowledge/write", element: withLayout(<RequireModule code="knowledge"><KnowledgeWritePage /></RequireModule>) },
  // device 模块
  { path: "/device/list", element: withLayout(<RequireModule code="device"><DeviceListPage /></RequireModule>) },
  { path: "/device/tasks", element: withLayout(<RequireModule code="device"><DeviceTasksPage /></RequireModule>) },
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
  { path: "/purchase-plans", element: withLayout(<PurchasePlansPage />) },
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
          // 设计系统 token（《UI设计方案.md》§2.1/§2.2）
          colorPrimary: "#1668dc",
          colorInfo: "#1668dc",
          colorLink: "#1668dc",
          colorBgLayout: "#f5f6f8",
          colorText: "#1f2329",
          colorTextSecondary: "#646a73",
          borderRadius: 6,
          fontSize: 14,
          fontFamily:
            '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
        },
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
