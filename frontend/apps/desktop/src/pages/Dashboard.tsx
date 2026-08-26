import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Alert, Button, Empty, Skeleton, Switch, Tag, theme } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, BarChartOutlined, CheckSquareOutlined, CodeSandboxOutlined, EditOutlined, ExportOutlined, FileTextOutlined, ReloadOutlined } from "@ant-design/icons";

import { reportApi, useAuthStore, type DashboardData } from "@wlt/shared";

import { ST, taskApi, type PoolItem } from "../modules/task/api";

const BAR_H = 140;

/** 千分位数字（设计页 13：统计数值 22/700 等宽）。 */
function fmt(n: number): string {
  return Number(n).toLocaleString("en-US");
}

const TASK_COL_META: Record<string, { fg: string; bg: string }> = {
  pending: { fg: "#B45309", bg: "#FEF4E2" },
  in_progress: { fg: "#0E7490", bg: "#E0F2FE" },
  done: { fg: "#7C3AED", bg: "#F3E8FF" },
};
const TASK_COLUMNS = ["pending", "in_progress", "done"];
const SOURCE_DOT: Record<string, string> = { cable: "#B45309", device: "#3B5BDB" };

/** 看板区块（自定义布局：编辑模式下可上下移动，顺序 localStorage 记忆）。 */
type BlockKey = "stats" | "trendTodo" | "taskBoard" | "quickLinks";
const DASH_ORDER_KEY = "wlt.dash.order";
const DEFAULT_ORDER: BlockKey[] = ["stats", "trendTodo", "taskBoard", "quickLinks"];
const BLOCK_TITLES: Record<BlockKey, string> = {
  stats: "统计卡",
  trendTodo: "趋势与待办",
  taskBoard: "维修任务看板",
  quickLinks: "快捷入口",
};

/** 维修任务看板小组件（任务模块启用且用户开启时显示）：
 *  三活动列（待领取/进行中/待审核）计数与近期任务，点击卡片直达任务看板定位。 */
function TaskBoardWidget({ reloadTick }: { reloadTick: number }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<PoolItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      // 仅活动任务；page_size 上限为后端 le=100
      const r = await taskApi.pool({ archived: 0, page_size: 100 });
      setTasks(r.items);
    } catch {
      setTasks([]); // 无权限等场景静默降级为空看板
    }
  }, []);
  useEffect(() => { void load(); }, [load, reloadTick]);

  const byStatus = useMemo(() => {
    const m: Record<string, PoolItem[]> = {};
    for (const c of TASK_COLUMNS) m[c] = [];
    for (const t of tasks ?? []) (m[t.status] ??= []).push(t);
    return m;
  }, [tasks]);

  return (
    <div className="wlt-glass" style={{ marginBottom: 16, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1E2433" }}>维修任务看板</span>
        <span style={{ padding: "3px 10px", borderRadius: 999, background: "#EFF3FC", fontSize: 11, fontWeight: 600, color: "#5B6478" }}>
          {(tasks ?? []).length}
        </span>
        <span style={{ flex: 1 }} />
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate("/task/board")}>查看完整看板 ›</Button>
      </div>
      {tasks === null ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {TASK_COLUMNS.map((key) => {
            const meta = TASK_COL_META[key];
            const list = byStatus[key] ?? [];
            return (
              <div key={key} style={{ background: "#F9FAFE", border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12, padding: 10, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Tag style={{ borderRadius: 999, background: meta.bg, color: meta.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{ST[key]?.label ?? key}</Tag>
                  <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: meta.fg }}>{list.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {list.slice(0, 3).map((t) => (
                    <div key={t.key} onClick={() => navigate(`/task/board?focus_task=${t.key}`)}
                      style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", borderRadius: 8, padding: "5px 8px", cursor: "pointer", minWidth: 0 }}
                      title={`${t.task_no} · ${ST[t.status]?.label ?? t.status}`}>
                      <span style={{ width: 7, height: 7, borderRadius: 4, background: SOURCE_DOT[t.source] ?? "#5B6478", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, color: "#1E2433", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                      {t.priority === 2 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#DC2626", flexShrink: 0 }}>急</span>}
                    </div>
                  ))}
                  {list.length === 0 && <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>暂无任务</span>}
                  {list.length > 3 && (
                    <Button type="link" size="small" style={{ padding: 0, fontSize: 11.5, alignSelf: "flex-start" }} onClick={() => navigate("/task/board")}>
                      还有 {list.length - 3} 条 ›
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 近 7 日出入库趋势（双柱：入库品牌蓝 / 出库浅青，设计页 13）。 */
function TrendChart({ trend }: { trend: DashboardData["trend_7d"] }) {
  const { token } = theme.useToken();
  if (trend.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无近 7 日出入库数据" />;
  }
  const max = Math.max(1, ...trend.map((t) => Math.max(Number(t.in_qty), Number(t.out_qty))));
  return (
    <div>
      {/* 图例胶囊：入库 #EAEFFF / 出库 #E0F2FE */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, background: "#EAEFFF", fontSize: 11, fontWeight: 600, color: "#3B5BDB" }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "#5B7FFF" }} />
          入库
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, background: "#E0F2FE", fontSize: 11, fontWeight: 600, color: "#0E7490" }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "#7CC4E8" }} />
          出库
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        {trend.map((t) => {
          const inH = Math.round((Number(t.in_qty) / max) * BAR_H);
          const outH = Math.round((Number(t.out_qty) / max) * BAR_H);
          const wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(t.date).getDay()];
          return (
            <div key={t.date} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "flex-end",
                  gap: 4,
                  height: BAR_H + 12,
                  paddingTop: 12,
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  cursor: "default",
                }}
                title={`${t.date} 入库 ${t.in_qty} 件 / 出库 ${t.out_qty} 件`}
              >
                <div style={{ width: 24, height: inH, minHeight: inH > 0 ? 2 : 0, background: "#5B7FFF", borderRadius: 6, transition: "height 0.3s ease" }} />
                <div style={{ width: 24, height: outH, minHeight: outH > 0 ? 2 : 0, background: "#7CC4E8", borderRadius: 6, transition: "height 0.3s ease" }} />
              </div>
              <div style={{ fontSize: 10, color: token.colorTextTertiary, marginTop: 6 }}>{wd}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 经营看板（电脑端，管理者）：页头快捷按钮 + 4 统计卡 + 近 7 日趋势 + 待办清单 +
 *  维修任务看板（任务模块启用时可选显示，localStorage 记忆）+ 快捷入口（设计页 13）。 */
export function DashboardPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const taskEnabled = moduleEnabled("task");
  const isSuper = user?.role?.code === "super_admin";
  const can = (perm: string) => isSuper || hasPerm(perm);

  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState("");
  // 任务看板显示开关：默认显示；用户关闭后 localStorage 记忆（wlt.dash.taskBoard=0）
  const [showTaskBoard, setShowTaskBoard] = useState<boolean>(() => localStorage.getItem("wlt.dash.taskBoard") !== "0");
  const [reloadTick, setReloadTick] = useState(0);
  // 自定义布局：编辑模式下区块可上下移动，顺序即时保存（wlt.dash.order）
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<BlockKey[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(DASH_ORDER_KEY) ?? "") as BlockKey[];
      const clean = DEFAULT_ORDER.filter((k) => raw.includes(k));
      if (clean.length === DEFAULT_ORDER.length) return clean;
    } catch { /* 解析失败回退默认 */ }
    return [...DEFAULT_ORDER];
  });

  const moveBlock = (key: BlockKey, dir: -1 | 1) => {
    setOrder((prev) => {
      const arr = [...prev];
      const i = arr.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      try { localStorage.setItem(DASH_ORDER_KEY, JSON.stringify(arr)); } catch { /* 忽略 */ }
      return arr;
    });
  };

  const load = useCallback(async () => {
    try {
      setData(await reportApi.dashboard());
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleTaskBoard = (v: boolean) => {
    setShowTaskBoard(v);
    localStorage.setItem("wlt.dash.taskBoard", v ? "1" : "0");
  };

  /** 页头动作按钮（设计页 13：白底灰描边 + 品牌图标 + 深色文字）。 */
  const headBtn = { borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" };

  /** 区块可见性：维修任务看板需任务模块启用且用户开启；其余恒可见。 */
  const applicable = (k: BlockKey) => k !== "taskBoard" || (taskEnabled && showTaskBoard);
  const visibleBlocks = order.filter(applicable);

  /** 区块渲染（自定义布局）：stats 统计卡 / trendTodo 趋势+待办 / taskBoard 任务看板 / quickLinks 快捷入口。 */
  const renderBlock = (bk: BlockKey) => {
    if (bk === "taskBoard") return <TaskBoardWidget reloadTick={reloadTick} />;
    if (!data) return null;
    if (bk === "stats") {
      return (
        /* 4 张统计卡（设计页 13：数值 22/700 彩色 + 标签 12.5，点击直达） */
        <div className="wlt-grid" style={{ marginBottom: 16 }}>
          {[
            { value: fmt(Number(data.today.in_qty)), label: "今日入库（件）", path: "/purchase-in", color: "#5B7FFF" },
            { value: fmt(Number(data.today.out_qty)), label: "今日出库（件）", path: "/stock", color: "#0E7490" },
            { value: fmt(data.alert_count), label: "库存预警", path: "/stock", color: "#DC2626" },
            { value: fmt(data.todos.pending_requisitions), label: "待审计领用单", path: "/requisitions", color: "#B45309" },
          ].map((c) => (
            <div key={c.label} className="wlt-glass" onClick={() => navigate(c.path)} style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" }}>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.5, color: c.color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{c.value}</div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: token.colorTextSecondary }}>{c.label}</div>
            </div>
          ))}
        </div>
      );
    }
    if (bk === "trendTodo") {
      return (
        /* 近 7 日趋势 + 待办清单（设计页 13：Trend 自适应 + Todo 330） */
        <div style={{ display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap", marginBottom: 16 }}>
          <div className="wlt-glass" style={{ flex: 1, minWidth: 340, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1E2433", marginBottom: 10 }}>近 7 日出入库趋势</div>
            <TrendChart trend={data.trend_7d} />
          </div>
          <div className="wlt-glass" style={{ width: 330, flexShrink: 0, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1E2433" }}>待办清单</span>
              <span style={{ padding: "3px 10px", borderRadius: 999, background: "#EFF3FC", fontSize: 11, fontWeight: 600, color: "#5B6478" }}>
                {data.todos.pending_requisitions + data.todos.pending_transfers + data.todos.pending_checks}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "待审计领用单", count: data.todos.pending_requisitions, path: "/requisitions", dot: "#DC2626" },
                { label: "待审核调拨单", count: data.todos.pending_transfers, path: "/transfers", dot: "#B45309" },
                { label: "盘点进行中", count: data.todos.pending_checks, path: "/checks", dot: "#5B7FFF" },
              ].map((item) => (
                <div
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "#F6F8FE",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: item.dot, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12.5, color: "#1E2433" }}>{item.label}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: item.count > 0 ? item.dot : token.colorTextTertiary }}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    return (
      /* 快捷入口（设计页 13：图标玻璃卡 ×5，按权限过滤）—— 严格一行 5 张 */
      <div className="wlt-grid" style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        {(
          [
            { label: "材料入库", icon: <FileTextOutlined />, color: "#5B7FFF", path: "/purchase-in", perm: "pch:in" },
            { label: "其他出库", icon: <ExportOutlined />, color: "#0E7490", path: "/other-io", perm: "stk:other" },
            { label: "领用申请", icon: <CheckSquareOutlined />, color: "#3B5BDB", path: "/requisitions/apply", perm: "req:apply" },
            { label: "盘点", icon: <CodeSandboxOutlined />, color: "#7C3AED", path: "/checks", perm: "stk:check" },
            { label: "报表中心", icon: <BarChartOutlined />, color: "#16A34A", path: "/reports", perm: "report:view" },
          ] as { label: string; icon: React.ReactNode; color: string; path: string; perm: string }[]
        )
          .filter((q) => can(q.perm))
          .map((q) => (
            <div key={q.path} className="wlt-glass" onClick={() => navigate(q.path)} style={{ flex: "1 1 150px", minWidth: 0, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, background: "#F6F8FE", color: q.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{q.icon}</div>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1E2433" }}>{q.label}</span>
            </div>
          ))}
      </div>
    );
  };

  return (
    <div style={{ padding: 24, width: "100%" }}>
      {/* 页头：标题 + 副题 + 快捷动作（设计页 13 幽灵按钮） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>经营看板</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            今日 / 本周 / 本月出入库汇总、库存预警与待办事项一览
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {can("pch:in") && <Button style={headBtn} icon={<FileTextOutlined style={{ color: "#5B7FFF" }} />} onClick={() => navigate("/purchase-in")}>新建采购入库</Button>}
          {can("req:audit") && <Button style={headBtn} icon={<CheckSquareOutlined style={{ color: "#5B7FFF" }} />} onClick={() => navigate("/requisitions")}>领用审计</Button>}
          {can("stk:check") && <Button style={headBtn} icon={<CodeSandboxOutlined style={{ color: "#5B7FFF" }} />} onClick={() => navigate("/checks")}>新建盘点</Button>}
          <Button
            style={headBtn}
            icon={<EditOutlined style={{ color: editing ? "#B45309" : "#5B6478" }} />}
            onClick={() => setEditing((v) => !v)}
          >{editing ? "完成编辑" : "编辑布局"}</Button>
          <Button style={headBtn} icon={<ReloadOutlined style={{ color: "#5B6478" }} />} onClick={() => { void load(); setReloadTick((t) => t + 1); }} aria-label="刷新" />
        </div>
      </div>
      {/* 任务模块启用时：任务看板显示开关（用户级偏好，localStorage 记忆） */}
      {taskEnabled && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, color: token.colorTextSecondary }}>显示维修任务看板</span>
          <Switch size="small" checked={showTaskBoard} onChange={toggleTaskBoard} aria-label="显示维修任务看板" />
        </div>
      )}

      {err && (
        <Alert
          type="error"
          showIcon
          title="看板数据加载失败"
          description={err}
          action={<Button size="small" danger onClick={() => void load()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      )}

      {!data && !err && (
        <div className="wlt-glass" style={{ marginBottom: 16, padding: 16 }}>
          <Skeleton active paragraph={{ rows: 2 }} />
        </div>
      )}

      {/* 编辑模式提示 */}
      {data && editing && (
        <div style={{ marginBottom: 12, fontSize: 12, color: token.colorTextSecondary }}>
          编辑布局：点击各区块右上角 ↑ / ↓ 调整显示顺序，改动即时保存；「维修任务看板」是否显示由页头上方开关控制。
        </div>
      )}

      {/* 按用户自定义顺序渲染区块（编辑模式下显示移动控件与虚线框） */}
      {data && visibleBlocks.map((bk, idx) => (
        <div key={bk} style={{ position: "relative", ...(editing ? { outline: "1px dashed #5B7FFF66", outlineOffset: 6, borderRadius: 14 } : null) }}>
          {renderBlock(bk)}
          {editing && (
            <div style={{ position: "absolute", top: -10, right: 8, zIndex: 5, display: "flex", alignItems: "center", gap: 2, background: "#FFFFFF", border: "1px solid #CBD6EC", borderRadius: 999, padding: "1px 4px", boxShadow: "0 2px 8px rgba(30,36,51,0.08)" }}>
              <span style={{ fontSize: 11, color: "#5B6478", padding: "0 4px" }}>{BLOCK_TITLES[bk]}</span>
              <Button size="small" type="text" disabled={idx === 0} icon={<ArrowUpOutlined />} onClick={() => moveBlock(bk, -1)} aria-label={`上移${BLOCK_TITLES[bk]}`} />
              <Button size="small" type="text" disabled={idx === visibleBlocks.length - 1} icon={<ArrowDownOutlined />} onClick={() => moveBlock(bk, 1)} aria-label={`下移${BLOCK_TITLES[bk]}`} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
