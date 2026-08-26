/** task 模块：维修任务列表（/task/list，task:dispatch/process）——统一任务池合并视图。
 *  v4：活动任务 / 已归档（已关闭自动归档，只读可查详情）两个视图；发布任务走标签式弹窗；
 *  来源列可跳转关联模块（故障管理 / 设备维修任务）；支持 ?focus_task=c12|d3 跨页定位。 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { App, Button, Drawer, Input, Popconfirm, Segmented, Select, Space, Table, Tag, theme, Upload } from "antd";
import { PlusOutlined, UploadOutlined, AppstoreOutlined, RobotOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { fileApi, useAuthStore } from "@wlt/shared";

import { FAULT_STATUS } from "../cable/api";
import { deviceApi } from "../device/api";
import { taskApi, ST, type PoolItem } from "./api";
import { PublishTaskModal } from "./PublishTaskModal";
import { TaskDetailModal } from "./TaskDetailModal";

export function TaskListPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<PoolItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<"" | "cable" | "device">("");
  const [archived, setArchived] = useState<0 | 1>(0); // 0 活动任务 / 1 已归档（需求 3）
  const [loading, setLoading] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [detail, setDetail] = useState<PoolItem | null>(null);
  // 记录抽屉仅服务活动线缆任务（设备任务记录跨模块跳转查看）
  const [current, setCurrent] = useState<PoolItem | null>(null);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof taskApi.records>>>([]);
  const [recContent, setRecContent] = useState("");
  const [recFile, setRecFile] = useState<File | null>(null);
  const [recSaving, setRecSaving] = useState(false);
  const [recommend, setRecommend] = useState<{ id: number; title: string; snippet: string }[]>([]);
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const cableEnabled = moduleEnabled("cable");
  const focusedKey = searchParams.get("focus_task") || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 统一任务池：archived 切换活动/归档视图（后端过滤终态）
      const r = await taskApi.pool({ status, keyword, source, archived, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [status, keyword, source, archived, page, pageSize, message]);

  useEffect(() => { void load(); }, [load]);

  /** 统一状态流转：按来源路由到对应模块接口。 */
  const act = async (t: PoolItem, action: string, extra?: object) => {
    try {
      const r = t.source === "device"
        ? await deviceApi.taskStatus(t.id, { action, ...extra })
        : await taskApi.status(t.id, { action, ...extra });
      message.success("已更新");
      const prompt = (r as { rollback_prompt?: string }).rollback_prompt;
      if (prompt) message.info(prompt, 5);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const cancel = async (t: PoolItem) => {
    await act(t, "cancel", { reason: "人工取消" });
  };

  const openRecords = async (t: PoolItem) => {
    if (t.source === "device") {
      navigate(`/device/tasks?focus=d${t.id}`);
      return;
    }
    setCurrent(t);
    setRecContent("");
    setRecFile(null);
    setRecommend([]);
    try {
      setRecords(await taskApi.records(t.id));
    } catch {
      setRecords([]);
    }
  };

  const addRecord = async () => {
    if (!current) return;
    setRecSaving(true);
    try {
      let fileId = 0;
      if (recFile) {
        const up = await fileApi.upload(recFile, "task");
        fileId = up.file_id;
      }
      await taskApi.addRecord(current.id, { content: recContent, files: fileId ? [{ file_id: fileId }] : [] });
      message.success("记录已保存");
      setRecContent("");
      setRecFile(null);
      setRecords(await taskApi.records(current.id));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRecSaving(false);
    }
  };

  const doRecommend = async () => {
    if (!current) return;
    try {
      const r = await taskApi.recommend(current.id);
      setRecommend(r.items ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "推荐失败");
    }
  };

  const columns: ColumnsType<PoolItem> = [
    { title: "任务", key: "task", width: 230, render: (_, t) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: "#1E2433" }}>{t.title}</div>
        <div style={{ fontSize: 10.5, color: "#8A93A8", marginTop: 2 }}>{t.task_no}</div>
      </div>
    ) },
    {
      title: "来源", key: "src", width: 190,
      render: (_, t) => t.source === "device" ? (
        <Space size={6}>
          <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}>设备</Tag>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={() => navigate(`/device/tasks?focus=d${t.id}`)}>{t.device_name}{t.device_code ? ` · ${t.device_code}` : ""} ›</Button>
        </Space>
      ) : (
        <Space size={6}>
          <Tag style={{ borderRadius: 999, background: "#FEF4E2", color: "#B45309", borderColor: "transparent", marginInlineEnd: 0 }}>线缆</Tag>
          {t.fault_id && cableEnabled
            ? <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={() => navigate(`/cable/faults?focus=${t.fault_id}`)}>故障 #{t.fault_id} ›</Button>
            : <span style={{ fontSize: 12, color: "#5B6478" }}>{t.fault_id ? `故障 #${t.fault_id}` : "人工派单"}</span>}
        </Space>
      ),
    },
    {
      title: "优先", key: "priority", width: 80,
      render: (_, t) => {
        const m = t.priority === 2 ? { label: "紧急", fg: "#DC2626", bg: "#FDEBEC" } : t.priority === 1 ? { label: "高优", fg: "#B45309", bg: "#FEF4E2" } : { label: "普通", fg: "#64748B", bg: "#EFF3FC" };
        return <Tag style={{ borderRadius: 999, background: m.bg, color: m.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{m.label}</Tag>;
      },
    },
    { title: "负责人", dataIndex: "assignee_name", width: 95, render: (v: string, t) => v || (t.status === "pending" && t.dispatch_mode !== "manual" ? <span style={{ color: "#3B5BDB", fontSize: 12 }}>待领取</span> : <span style={{ color: "#8A93A8", fontSize: 12 }}>—</span>) },
    { title: "状态", key: "status", width: 100, render: (_, t) => { const s = ST[t.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? t.status}</Tag>; } },
    {
      title: "联动状态", key: "link", width: 120,
      render: (_, t) => {
        if (t.source === "cable" && t.fault_id && t.fault_status != null) {
          const f = FAULT_STATUS[t.fault_status];
          return <Tag style={{ borderRadius: 999, background: f?.bg, color: f?.fg, borderColor: "transparent", marginInlineEnd: 0 }} title={`关联故障 #${t.fault_id} 当前状态`}>故障·{f?.label ?? t.fault_status}</Tag>;
        }
        if (t.source === "device") {
          return <span style={{ fontSize: 12, color: "#8A93A8" }}>{t.device_name}</span>;
        }
        return <span style={{ color: "#8A93A8", fontSize: 12 }}>—</span>;
      },
    },
    { title: "排期", dataIndex: "scheduled_time", width: 115, render: (v: string | null) => v ? <span style={{ fontSize: 12, color: "#8A93A8", fontVariantNumeric: "tabular-nums" }}>{v.slice(0, 16).replace("T", " ")}</span> : <span style={{ color: "#8A93A8", fontSize: 12 }}>—</span> },
    {
      title: "操作", width: archived ? 90 : 200,
      render: (_, t) => {
        if (archived) {
          // 归档视图：仅可查看完整详情（不可再流转/回退，重开请重新发布任务）
          return (
            <Space size={10} style={{ padding: "0 10px" }}>
              <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#5B6478" }} onClick={() => setDetail(t)}>详情</Button>
            </Space>
          );
        }
        const claimHint = t.source === "device" && t.status === "pending" && t.dispatch_mode !== "manual" && !t.assignee_id;
        return (
          <Space size={10} style={{ padding: "0 10px", flexWrap: "wrap" }}>
            <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#5B6478" }} onClick={() => openRecords(t)}>
              {t.source === "device" ? "详情 ›" : "记录"}
            </Button>
            <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#5B6478" }} onClick={() => setDetail(t)}>详情</Button>
            {claimHint && (
              <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#3B5BDB" }} onClick={() => navigate(`/device/tasks?focus=d${t.id}`)}>领取 ›</Button>
            )}
            {t.status === "done" && (
              <>
                <Popconfirm title="验收通过该任务？" onConfirm={() => void act(t, "verify", { verdict: "验收通过" })}>
                  <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#15803D" }}>验收</Button>
                </Popconfirm>
                <Popconfirm title="驳回该任务？" onConfirm={() => void act(t, "reject", { verdict: "驳回重做" })}>
                  <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#DC2626" }}>驳回</Button>
                </Popconfirm>
              </>
            )}
            {(t.status === "pending" || t.status === "assigned") && !claimHint && (
              <Popconfirm title="取消该任务（需填写原因）？" onConfirm={() => cancel(t)}>
                <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#DC2626" }}>取消</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>维修任务列表</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            统一任务池{archived ? " · 已归档（已关闭/已取消，仅可查看详情）" : ""}：联动状态同步展示，可跳转故障管理与设备维修任务
          </p>
        </div>
        <Space>
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<AppstoreOutlined style={{ color: "#5B7FFF" }} />} onClick={() => navigate("/task/board")}>切换看板视图</Button>
          {!archived && <Button type="primary" icon={<PlusOutlined />} onClick={() => setPublishOpen(true)}>发布任务</Button>}
        </Space>
      </div>

      {/* 筛选条 */}
      <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Segmented
          value={archived}
          onChange={(v) => { setArchived(v as 0 | 1); setPage(1); }}
          options={[{ value: 0, label: "活动任务" }, { value: 1, label: "已归档" }]}
        />
        <Input
          prefix={<SearchOutlined style={{ color: "#8A93A8" }} />}
          placeholder="任务单号 / 内容"
          allowClear
          style={{ width: 240, background: "#F6F8FE" }}
          onChange={(e) => { if (!e.target.value) { setKeyword(""); setPage(1); } }}
          onPressEnter={(e) => { setKeyword((e.target as HTMLInputElement).value.trim()); setPage(1); }}
        />
        <Select placeholder="全部状态" allowClear style={{ width: 140 }} value={status || undefined} onChange={(v) => { setStatus(v ?? ""); setPage(1); }}
          options={Object.entries(ST).map(([k, v]) => ({ value: k, label: v.label }))} />
        <Select placeholder="全部来源" allowClear style={{ width: 140 }} value={source || undefined} onChange={(v) => { setSource(v ?? ""); setPage(1); }}
          options={[
            { value: "cable", label: "线缆任务" },
            ...(moduleEnabled("device") ? [{ value: "device", label: "设备任务" }] : []),
          ]} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A93A8" }}>共 {total} 条</span>
      </div>

      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<PoolItem>
          rowKey="key" loading={loading} dataSource={rows} locale={{ emptyText: archived ? "暂无归档任务" : "暂无任务" }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); } }}
          columns={columns}
          rowClassName={(r) => (r.key === focusedKey ? "wlt-row-focus" : "")}
        />
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#8A93A8" }}>
          提示：「联动状态」列为关联故障/设备的实时状态；已关闭/已取消任务自动进入「已归档」，终态不可回退（重开请重新发布任务并关联原对象）
        </p>
      </div>

      {/* 发布任务（标签式弹窗） */}
      <PublishTaskModal open={publishOpen} onClose={() => { setPublishOpen(false); void load(); }} />

      {/* 详情弹窗 */}
      <TaskDetailModal item={detail} onClose={() => setDetail(null)} onChanged={() => void load()} />

      {/* 新建纯任务（无关联快速建单入口保留在详情/看板；此处不再提供独立表单） */}

      {/* 维修记录抽屉（活动线缆任务） */}
      <Drawer open={!!current} onClose={() => setCurrent(null)} width={560} title={current ? `维修记录：${current.title}` : ""}>
        {current && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {records.map((r) => (
              <div key={r.id} className="wlt-glass-sm" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13 }}>{r.content || "（无文字记录）"}</div>
                {r.files.length > 0 && (
                  <Space wrap>
                    {r.files.map((f) => <img key={f.id} src={`/api/v1/files/${f.file_id}`} width={80} height={60} style={{ objectFit: "cover", borderRadius: 10 }} alt="" />)}
                  </Space>
                )}
                <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>{new Date(r.created_at).toLocaleString()}</div>
              </div>
            ))}
            {(current.status === "in_progress" || current.status === "assigned") ? (
              <>
                <Input.TextArea rows={3} value={recContent} onChange={(e) => setRecContent(e.target.value)} placeholder="维修内容" />
                <Upload beforeUpload={(f) => { setRecFile(f); return false; }} maxCount={1} accept="image/*" showUploadList={false}>
                  <Button icon={<UploadOutlined />}>{recFile ? "已选照片（点击更换）" : "选择维修照片（完成必填）"}</Button>
                </Upload>
                <Button type="primary" loading={recSaving} onClick={addRecord}>保存记录</Button>
                <Button icon={<RobotOutlined />} onClick={doRecommend}>知识推荐</Button>
                {recommend.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>推荐知识</span>
                    {recommend.map((a) => <div key={a.id} className="wlt-glass-sm" style={{ padding: 10 }}>{a.title}</div>)}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: token.colorTextTertiary, textAlign: "center", padding: 12 }}>该任务当前状态不可追加维修记录</div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
