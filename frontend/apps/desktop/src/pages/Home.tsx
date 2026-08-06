import { useNavigate } from "react-router-dom";

import { otherEndUrl, useAuthStore } from "@wlt/shared";

interface Entry {
  title: string;
  path: string;
  perm: string;
  desc: string;
}

const ENTRIES: Entry[] = [
  { title: "经营看板", path: "/dashboard", perm: "report:view", desc: "出入库统计 · 预警 · 待办 · 7 日趋势" },
  { title: "报表中心", path: "/reports", perm: "report:view", desc: "进销存汇总 · 库存报表 · Excel 导出" },
  { title: "仓库货架图", path: "/warehouses", perm: "base:warehouse", desc: "2D 分层货架 · 库位库存与预警" },
  { title: "采购入库", path: "/purchase-in", perm: "pch:in", desc: "入库单 · 送货单 OCR 录入" },
  { title: "库存调拨", path: "/transfers", perm: "stk:transfer", desc: "仓库间调拨 · 审核" },
  { title: "库存盘点", path: "/checks", perm: "stk:check", desc: "盘点单 · 录实盘 · 审核" },
  { title: "其他出入库", path: "/other-io", perm: "stk:other", desc: "报废/报损/赠品" },
  { title: "送货单 OCR 录入", path: "/ocr/delivery", perm: "pch:ocr", desc: "拍照识别送货单 → 带入入库" },
  { title: "AI 建议处理", path: "/ai-suggestions", perm: "ocr:manage", desc: "未匹配商品识别建议 · 确认新增" },
  { title: "系统设置", path: "/system/settings", perm: "sys:config", desc: "OCR 引擎 · 大模型 API" },
  { title: "用户管理", path: "/system/users", perm: "sys:user", desc: "账号 · 角色分配 · 启用停用" },
  { title: "角色与权限", path: "/system/roles", perm: "sys:role", desc: "角色 · 权限点分配" },
  { title: "操作日志", path: "/system/logs", perm: "sys:log", desc: "写操作审计查询" },
  { title: "备份管理", path: "/system/backups", perm: "sys:backup", desc: "手动/自动备份 · 下载" },
];

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const navigate = useNavigate();

  const entries = ENTRIES.filter((e) => hasPerm(e.perm));

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>物料通 · 工作台</h2>
        <div>
          <span style={{ marginRight: 12 }}>
            {user?.real_name}（{user?.role?.name}）
          </span>
          <a href={otherEndUrl("mobile")} style={{ marginRight: 12, color: "#1677ff" }}>
            手机版
          </a>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            退出登录
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, marginTop: 24 }}>
        {entries.map((e) => (
          <button
            key={e.path}
            onClick={() => navigate(e.path)}
            style={{
              padding: 20,
              textAlign: "left",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              background: "#fff",
              cursor: "pointer",
              transition: "box-shadow .2s",
            }}
            onMouseEnter={(ev) => (ev.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,.08)")}
            onMouseLeave={(ev) => (ev.currentTarget.style.boxShadow = "none")}
          >
            <div style={{ fontSize: 16, fontWeight: 600 }}>{e.title}</div>
            <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>{e.desc}</div>
          </button>
        ))}
      </div>
      {!entries.length && <p style={{ color: "#999", marginTop: 24 }}>当前角色暂无可用功能入口。</p>}
    </div>
  );
}
