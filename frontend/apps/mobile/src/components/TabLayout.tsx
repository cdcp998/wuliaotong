import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { TabBar } from "antd-mobile";

import { notificationApi } from "@wlt/shared";

interface TabItem {
  key: string;
  title: string;
  path: string;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
}

const stroke = (path: React.ReactNode, filled = false) => (
  <svg viewBox="0 0 24 24" width={22} height={22} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const TABS: TabItem[] = [
  {
    key: "home",
    title: "首页",
    path: "/",
    icon: stroke(<><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></>),
    activeIcon: stroke(<path d="M12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5z" />, true),
  },
  {
    key: "functions",
    title: "功能",
    path: "/functions",
    icon: stroke(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
    activeIcon: stroke(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>, true),
  },
  {
    key: "notice",
    title: "通知",
    path: "/notifications",
    icon: stroke(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>),
    activeIcon: stroke(<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" fill="currentColor" stroke="none" />, true),
  },
  {
    key: "mine",
    title: "我的",
    path: "/mine",
    icon: stroke(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>),
    activeIcon: stroke(<path d="M12 4a4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4-4zm-8 17c0-4 3.6-6 8-6s8 2 8 6z" fill="currentColor" stroke="none" />, true),
  },
];

/** 手机端 TabBar 布局：首页/功能/通知/我的（四 Tab；领用入口在「功能」页卡片，
 *  不再占用底部导航——/requisitions/new 路由保留，功能页/我的申请/OCR 仍可进入）。 */
export function TabLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  // 内容滚动容器：TabBar 点击当前 Tab → 平滑回到顶端；切换 Tab → 路由变化即时回顶端
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeKey = (() => {
    // 拍照识别页（/ocr/scan）现归属「功能」Tab 高亮（功能卡片里的「拍照识别」进入）
    if (location.pathname.startsWith("/ocr/scan")) return "functions";
    const hit = TABS.find((t) => (t.path !== "/" ? location.pathname.startsWith(t.path) : location.pathname === t.path));
    // 非 Tab 页（如 /requisitions/new、/stock/query）不高亮任何 Tab，避免误亮「首页」
    return hit?.key ?? "";
  })();

  // 路由切换（点击不同 Tab）时内容区即时回顶，避免停留在上一页的滚动位置
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  // 未读角标：进入即拉取 + 30s 轮询（前端设计 §6）
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      notificationApi
        .unreadCount()
        .then((d) => {
          if (alive) setUnread(d.unread_count);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "#F2F5FB" }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        <Outlet />
      </div>
      <TabBar
        activeKey={activeKey}
        onChange={(key) => {
          const tab = TABS.find((t) => t.key === key);
          if (tab) navigate(tab.path);
        }}
        style={{
          borderTop: "1px solid #E4EAF6",
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(10px)",
          paddingBottom: 6,
          boxShadow: "0 -4px 16px rgba(30,36,51,0.05)",
        }}
      >
        {TABS.map((t) => (
          <TabBar.Item
            key={t.key}
            icon={(active: boolean) => (active ? t.activeIcon : t.icon)}
            title={t.title}
            badge={t.key === "notice" && unread > 0 ? (unread > 99 ? "99+" : String(unread)) : undefined}
            onClick={() => {
              // 再次点击当前 Tab：内容区平滑回到顶端（onChange 对同值不触发，故在 item 级处理）
              if (t.key === activeKey) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ))}
      </TabBar>
    </div>
  );
}
