/** device 模块：设备维修任务（/device/tasks，device:task）——创建（复用 DeviceTaskForm）/任务池领取处理/
 *  处理完毕（图片可选）/后台审核（通过即归档+快照回退）+ 维修记录。
 *  v2 无锁协作制：无派发/接单，维修人员均可领取接力，人员留痕；合并显示在任务管理统一任务池。
 *  支持跨页定位（?focus=d{id}）。 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { App, Button, Drawer, Input, Modal, Popconfirm, Space, Table, Tag, theme, Tooltip, Upload } from "antd";
import { CheckOutlined, DeleteOutlined, FileDoneOutlined, FileImageOutlined, PlusOutlined, ReloadOutlined, SendOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { fileApi } from "@wlt/shared";

import { DEVICE_STATUS, deviceApi, type DeviceTaskItem } from "./api";
import { DeviceTaskForm } from "./DeviceTaskForm";

const ST: Record<string, { label: string; fg: string; bg: string }> = {
  pending: { label: "待领取", fg: "#B45309", bg: "#FEF4E2" },
  assigned: { label: "已派发", fg: "#3B5BDB", bg: "#EAEFFF" },
  in_progress: { label: "进行中", fg: "#0E7490", bg: "#E0F2FE" },
  done: { label: "待审核", fg: "#7C3AED", bg: "#F3E8FF" },
  verified: { label: "已验证", fg: "#15803D", bg: "#E8F9EF" },
  closed: { label: "已关闭", fg: "#475569", bg: "#EFF3FC" },
  cancelled: { label: "已取消", fg: "#B91C1C", bg: "#FDEBEC" },
};
const FLOW_STEPS = ["待领取", "进行中", "待审核", "已归档"];

export function DeviceTasksPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [searchParams] = useSearchParams();
  const focusedKey = searchParams.get("focus") || ""; // 跨页定位（任务看板/列表跳转入口）：d{task_id}
  const [rows, setRows] = useState<DeviceTaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<DeviceTaskItem | null>(null);
  const [verdict, setVerdict] = useState("");
  const [records, setRecords] = useState<Awaited<ReturnType<typeof deviceApi.records>>>([]);
  const [recContent, setRecContent] = useState("");
  const [recFile, setRecFile] = useState<File | null>(null);
  const [recSaving, setRecSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await deviceApi.listTasks({ status: filterStatus, page, page_size: pageSize });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, page, pageSize, message]);

  useEffect(() => { void load(); }, [load]);
  // 跨页定位：?focus=d{id} → 自动打开对应任务抽屉（统一任务池联动入口）
  useEffect(() => {
    if (!focusedKey || loading || rows.length === 0) return;
    const id = Number(focusedKey.replace(/^d/, ""));
    const t = rows.find((x) => x.id === id);
    if (t) { setCurrent(t); setRecords([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loading]);

  const act = async (t: DeviceTaskItem, action: string, extra?: object) => {
    try {
      await deviceApi.taskStatus(t.id, { action, ...extra });
      message.success("已更新");
      setCurrent(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const openRecords = async (t: DeviceTaskItem) => {
    setCurrent(t);
    setRecords([]);
    setRecContent("");
    setRecFile(null);
    try {
      setRecords(await deviceApi.records(t.id));
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
        const up = await fileApi.upload(recFile, "device_task");
        fileId = up.file_id;
      }
      await deviceApi.addRecord(current.id, { content: recContent, files: fileId ? [{ file_id: fileId }] : [] });
      message.success("记录已保存");
      setRecContent("");
      setRecFile(null);
      setRecords(await deviceApi.records(current.id));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRecSaving(false);
    }
  };

  const columns: ColumnsType<DeviceTaskItem> = [
    { title: "任务", width: 280, render: (_, t) => (
      <div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.title}</div>
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{t.task_no} · 创建 {t.creator_name}</div>
      </div>
    ) },
    { title: "设备", width: 180, render: (_, t) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 12.5 }}>{t.device_name}</div>
        <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{t.device_code}</div>
      </div>
    ) },
    { title: "优先级", width: 90, render: (_, t) => (t.priority === 2 ? <Tag color="red" style={{ borderRadius: 999 }}>紧急</Tag> : <Tag style={{ borderRadius: 999, color: "#475569", background: "#EFF3FC", borderColor: "transparent" }}>普通</Tag>) },
    { title: "状态", width: 110, render: (_, t) => { const s = ST[t.status]; return <Tag style={{ borderRadius: 999, background: s?.bg, color: s?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s?.label ?? t.status}</Tag>; } },
    { title: "参与人", key: "members", width: 120, render: (_, t) => {
      const names = t.participants?.map((p) => p.name) ?? [];
      return names.length > 0
        ? <span title={names.join("、")} style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{names.join("、")}</span>
        : <span style={{ color: token.colorTextTertiary }}>暂无人接手</span>;
    } },
    { title: "计划时间", dataIndex: "scheduled_time", width: 130, render: (v: string | null) => v ? <span style={{ fontSize: 12 }}>{v.slice(0, 16)}</span> : <span style={{ color: token.colorTextTertiary }}>—</span> },
    {
      title: "操作", width: 210,
      render: (_, t) => {
        return (
        <Space size={2}>
          <Tooltip title="维修记录"><Button size="small" icon={<FileImageOutlined />} onClick={() => openRecords(t)} /></Tooltip>
          {t.status === "pending" && <Tooltip title="领取并处理（无锁协作，人员留痕）"><Button size="small" type="primary" icon={<SendOutlined />} onClick={() => act(t, "claim")} /></Tooltip>}
          {t.status === "in_progress" && <Tooltip title="处理完毕（上传图片可选）"><Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => act(t, "complete")} /></Tooltip>}
          {t.status === "done" && <Tooltip title="后台审核"><Button size="small" type="primary" icon={<FileDoneOutlined />} onClick={() => { setCurrent(t); setVerdict(""); }} /></Tooltip>}
          {(t.status === "pending" || t.status === "assigned" || t.status === "in_progress") && (
            <Popconfirm title="取消任务（设备状态将按快照回退）？" onConfirm={() => act(t, "cancel", { reason: "人工取消" })}>
              <Tooltip title="取消"><Button size="small" danger icon={<DeleteOutlined />} /></Tooltip>
            </Popconfirm>
          )}
        </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>设备故障管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>与线缆任务共用任务池与状态机：创建自动置「维修中」，后台审核通过即归档并按快照回退原状态</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建设备维修</Button>
        </Space>
      </div>

      {/* 状态 Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {[["", "全部"], ["pending", "待领取"], ["in_progress", "进行中"], ["done", "待审核"], ["closed", "已关闭"], ["cancelled", "已取消"]].map(([st, label]) => {
          const active = filterStatus === st;
          return (
            <button key={st} type="button" onClick={() => { setFilterStatus(st); setPage(1); }}
              style={{ cursor: "pointer", border: `1px solid ${active ? "#5B7FFF" : token.colorBorder}`, background: active ? "#5B7FFF" : "#fff", color: active ? "#fff" : token.colorTextSecondary, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: active ? 600 : 500, display: "inline-flex", gap: 6, alignItems: "center", fontFamily: "inherit", transition: "all .2s ease" }}>
              {label}
            </button>
          );
        })}
      </div>

      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<DeviceTaskItem>
          rowKey="id" loading={loading} dataSource={rows} locale={{ emptyText: "暂无设备故障任务" }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p, ps) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else setPage(p); } }}
          columns={columns}
          rowClassName={(r) => (`d${r.id}` === focusedKey ? "wlt-row-focus" : "")}
        />
        {/* 状态流转说明 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "12px 10px 4px", borderTop: `1px solid ${token.colorBorder}`, marginTop: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: token.colorTextSecondary }}>状态流转</span>
          {FLOW_STEPS.map((s, i) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 11.5, padding: "3px 10px", borderRadius: 999, background: i === 3 ? "#F3E8FF" : "#F6F8FE", color: i === 3 ? "#7C3AED" : token.colorTextSecondary, fontWeight: i === 3 ? 700 : 400 }}>{s}</span>
              {i < FLOW_STEPS.length - 1 && <span style={{ color: token.colorTextTertiary }}>›</span>}
            </span>
          ))}
          <span style={{ fontSize: 11, color: token.colorTextTertiary, marginLeft: 8 }}>任务完成 → 设备自动回退上一状态（快照前一状态）</span>
        </div>
      </div>

      {/* 新建任务（复用 DeviceTaskForm：发布任务弹窗的设备任务页签嵌入同一表单） */}
      <Modal open={open} onCancel={() => setOpen(false)} title="新建设备故障任务" width={560} destroyOnHidden footer={null}>
        <DeviceTaskForm
          onCancel={() => setOpen(false)}
          onSubmitted={() => {
            setOpen(false);
            void load();
          }}
        />
      </Modal>

      {/* 领取/审核/记录抽屉 */}
      <Drawer open={!!current} onClose={() => setCurrent(null)} width={560} title={current ? `设备任务：${current.title}` : ""}>
        {current && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {current.status === "pending" && (
              <Popconfirm title="领取并处理该任务？过程不锁人，其他维修人员仍可接续。" onConfirm={() => act(current, "claim")}>
                <Button type="primary">领取并处理</Button>
              </Popconfirm>
            )}
            {current.status === "done" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Input value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="审核结论 / 驳回理由（必填）" />
                <Space wrap>
                  <Popconfirm title="审核通过？任务将归档进入任务历史。" onConfirm={() => act(current, "verify", { verdict })}>
                    <Button type="primary" disabled={!verdict.trim()}>审核通过（归档）</Button>
                  </Popconfirm>
                  <Popconfirm title="驳回该任务？将带理由退回全部参与人重做。" onConfirm={() => act(current, "reject", { verdict })}>
                    <Button danger disabled={!verdict.trim()}>驳回（退回重做）</Button>
                  </Popconfirm>
                </Space>
              </div>
            )}
            {current.verdict && <span style={{ fontSize: 12.5, color: token.colorTextSecondary }}>结论：{current.verdict}{current.status === "closed" ? `（设备状态已回退至 ${DEVICE_STATUS[current.previous_status]?.label ?? "在用"}）` : ""}</span>}
            {records.map((r) => (
              <div key={r.id} className="wlt-glass-sm" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13 }}>{r.content || "（无文字记录）"}</div>
                {r.files.map((f) => <img key={f.id} src={`/api/v1/files/${f.file_id}`} width={80} height={60} style={{ objectFit: "cover", borderRadius: 10, marginTop: 4 }} alt="" />)}
                <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>{new Date(r.created_at).toLocaleString()}</div>
              </div>
            ))}
            {(current.status === "in_progress" || current.status === "assigned") && (
              <>
                <Input.TextArea rows={3} value={recContent} onChange={(e) => setRecContent(e.target.value)} placeholder="维修内容（可选）" />
                <Upload beforeUpload={(f) => { setRecFile(f); return false; }} maxCount={1} accept="image/*" showUploadList={false}>
                  <Button icon={<UploadOutlined />}>{recFile ? "已选照片（点击更换）" : "选择维修照片（可选）"}</Button>
                </Upload>
                <Button type="primary" loading={recSaving} onClick={addRecord}>保存记录</Button>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
