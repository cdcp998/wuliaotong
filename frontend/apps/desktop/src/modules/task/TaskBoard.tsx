/** task 模块：维修任务看板（/task/board，task:dispatch）——统一任务池合并视图（v6 简略卡片）。
 *  · v2 无锁协作三活动列（待领取›进行中›待审核）；过程不锁人、人员留痕；审核通过即归档进历史；
 *  · 卡片简略展示：类型/优先级/标题/一行摘要/参与人/排期；点击弹出详情 Modal（完整信息+操作）；
 *  · 「发布任务」走标签式弹窗（设备任务/线缆任务，嵌入对应模块表单）；
 *  · 支持 ?focus_task=c12|d3 跨页定位。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Select, Space, Tag, theme } from "antd";
import { UnorderedListOutlined, PlusOutlined } from "@ant-design/icons";

import { useAuthStore } from "@wlt/shared";

import { taskApi, ST, type PoolItem } from "./api";
import { PublishTaskModal } from "./PublishTaskModal";
import { TaskDetailModal } from "./TaskDetailModal";

/** 看板仅展示活动列（审核通过即归档）。 */
const COLUMNS = ["pending", "in_progress", "done"];

const COL_META: Record<string, { fg: string; bg: string; dot: string }> = {
  pending: { fg: "#B45309", bg: "#FEF4E2", dot: "#F59E0B" },
  in_progress: { fg: "#0E7490", bg: "#E0F2FE", dot: "#0891B2" },
  done: { fg: "#7C3AED", bg: "#F3E8FF", dot: "#8B5CF6" },
};

export function TaskBoardPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const deviceEnabled = moduleEnabled("device");
  const [tasks, setTasks] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"" | "cable" | "device">("");
  const [detail, setDetail] = useState<PoolItem | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 统一任务池（archived=0：仅活动任务；page_size 上限为后端 le=100）
      const r = await taskApi.pool({ page_size: 100, source, archived: 0 });
      setTasks(r.items);
    } finally {
      setLoading(false);
    }
  }, [source]);
  useEffect(() => { void load(); }, [load]);

  /** 跨页定位：?focus_task=c12|d3 → 自动打开对应任务详情弹窗。 */
  useEffect(() => {
    const key = searchParams.get("focus_task");
    if (!key || loading || tasks.length === 0) return;
    const t = tasks.find((x) => x.key === key);
    if (t) setDetail(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, loading]);

  const byStatus = useMemo(() => {
    const m: Record<string, PoolItem[]> = {};
    for (const c of COLUMNS) m[c] = [];
    for (const t of tasks) (m[t.status] ??= []).push(t);
    return m;
  }, [tasks]);

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>维修任务看板</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            统一任务池{deviceEnabled ? "（线缆 + 设备合并显示）" : ""} · 无锁协作：维修人员均可领取/接力处理，人员留痕；审核通过即归档
          </p>
        </div>
        <Space wrap>
          <Select
            value={source}
            onChange={(v) => setSource(v ?? "")}
            style={{ width: 150 }}
            options={[
              { value: "", label: "全部来源" },
              { value: "cable", label: "仅线缆任务" },
              ...(deviceEnabled ? [{ value: "device", label: "仅设备任务" }] : []),
            ]}
          />
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<UnorderedListOutlined style={{ color: "#5B7FFF" }} />} onClick={() => navigate("/task/list")}>切换列表视图</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setPublishOpen(true)}>发布任务</Button>
        </Space>
      </div>

      {/* 看板（简略卡片） */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(170px, 1fr))`, gap: 10, overflowX: "auto", paddingBottom: 4 }}>
        {COLUMNS.map((status) => {
          const meta = COL_META[status];
          const items = byStatus[status] ?? [];
          return (
            <div key={status} style={{ background: "#FFFFFF", border: `1px solid #E4EAF6`, borderRadius: 14, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: meta.dot }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{ST[status]?.label ?? status}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#6A748A" }}>{items.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {loading && items.length === 0 && <div style={{ color: token.colorTextTertiary, fontSize: 12, textAlign: "center", padding: 12 }}>加载中…</div>}
                {!loading && items.length === 0 && <div style={{ color: token.colorTextTertiary, fontSize: 11.5, textAlign: "center", padding: 12, border: "1px dashed #CBD6EC", borderRadius: 10 }}>暂无任务</div>}
                {items.map((t) => {
                  const focused = searchParams.get("focus_task") === t.key;
                  // 一行摘要：关联对象 + 描述截断（不超过一行）
                  const linkText = t.source === "cable"
                    ? (t.fault_id ? `故障#${t.fault_id}${t.fault_type ? ` ${t.fault_type}` : ""}` : t.cable_name || "")
                    : `${t.device_name}${t.device_code ? ` ${t.device_code}` : ""}`;
                  const summary = [linkText, t.description].filter(Boolean).join(" · ") || t.task_no;
                  return (
                    <div key={t.key} onClick={() => setDetail(t)}
                      style={{ cursor: "pointer", background: focused ? "#EAEFFF" : "#F6F8FE", outline: focused ? "2px solid #5B7FFF" : "none", border: `1px solid ${t.priority === 2 ? "#FCA5A5" : "#E4EAF6"}`, borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      {/* 行1：来源徽标 + 优先级 */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: t.source === "device" ? "#3B5BDB" : "#B45309", background: t.source === "device" ? "#EAEFFF" : "#FEF4E2", borderRadius: 999, padding: "1px 8px" }}>
                          {t.source === "device" ? "设备" : "线缆"}
                        </span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: t.priority === 2 ? "#EF4444" : t.priority === 1 ? "#F59E0B" : "#6A748A" }}>
                          {t.priority === 2 ? "紧急" : t.priority === 1 ? "高优" : "普通"}
                        </span>
                      </div>
                      {/* 行2：标题（单行） */}
                      <span title={t.title} style={{ fontSize: 11.5, fontWeight: 600, color: "#1E2433", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                      {/* 行3：一行摘要（单行截断） */}
                      <span title={summary} style={{ fontSize: 10.5, color: "#6A748A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>
                      {/* 行4：参与人 + 排期（截断 MM-DD HH:mm；无锁协作显示接力人员） */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#5B6478" }}>
                        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {(t.participants?.length ?? 0) > 0
                            ? t.participants!.map((p) => p.name).join("、")
                            : "暂无人接手"}
                          {t.scheduled_time ? ` · ${t.scheduled_time.slice(5, 16).replace("T", " ")}` : ""}
                        </span>
                      </div>
                      {/* 行5：状态胶囊 */}
                      <Tag style={{ borderRadius: 999, background: meta.bg, color: meta.fg, borderColor: "transparent", marginInlineEnd: 0, alignSelf: "flex-start" }}>
                        {ST[t.status]?.label ?? t.status}
                      </Tag>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 详情弹窗（点击卡片 / 跨页定位） */}
      <TaskDetailModal item={detail} onClose={() => setDetail(null)} onChanged={() => void load()} />

      {/* 发布任务（标签式：设备任务 / 线缆任务） */}
      <PublishTaskModal open={publishOpen} onClose={() => { setPublishOpen(false); void load(); }} />
    </div>
  );
}
