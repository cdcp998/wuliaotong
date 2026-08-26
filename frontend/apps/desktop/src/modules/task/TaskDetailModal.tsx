/** task 模块：任务详情弹窗（需求 4）——点击看板简略卡片弹出，展示完整信息。
 *  含：完整描述、关联设备/线缆详情（跨模块跳转）、操作时间线、维修记录与照片附件；
 *  按权限/状态渲染操作按钮（派发/验收/驳回/关闭任务/取消）；终态只读（不可回退，
 *  如需重开请新建任务并关联原故障/设备）。支持关闭按钮 / 点击遮罩 / Esc 关闭。 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Descriptions, Input, Modal, Popconfirm, Select, Space, Tag, Timeline, theme } from "antd";

import { adminApi, useAuthStore } from "@wlt/shared";

import { FAULT_STATUS } from "../cable/api";
import { DEVICE_STATUS, deviceApi } from "../device/api";
import { ST, taskApi, type PoolItem } from "./api";

export function TaskDetailModal({ item, onClose, onChanged }: {
  item: PoolItem | null;
  onClose: () => void;
  /** 任一状态操作成功后回调（父级刷新列表）。 */
  onChanged?: () => void;
}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const isManager = ["super_admin", "manager", "dispatcher"].includes(me?.role?.code ?? "");
  const [workers, setWorkers] = useState<{ id: number; name: string }[]>([]);
  const [assignee, setAssignee] = useState<number | undefined>();
  const [verdict, setVerdict] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  /** 维修记录（两来源结构取交集：id/content/created_at/files[{id,file_id}]）。 */
  const [records, setRecords] = useState<{ id: number; content: string; created_at: string; files: { id: number; file_id: number }[] }[]>([]);

  useEffect(() => {
    adminApi.users({ role_id: 6, status: 1, page_size: 100 })
      .then((r) => setWorkers(r.list.map((u) => ({ id: u.id, name: u.real_name || u.username }))))
      .catch(() => undefined);
  }, []);

  // 打开时拉取维修记录（含照片附件）；失败静默（无记录展示）
  useEffect(() => {
    setRecords([]);
    setAssignee(undefined);
    setVerdict("");
    setCancelReason("");
    setEditing(false);
    if (!item) return;
    const load = item.source === "device" ? deviceApi.records(item.id) : taskApi.records(item.id);
    load.then(setRecords).catch(() => setRecords([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key]);

  if (!item) return <Modal open={false} onCancel={onClose} footer={null}><div /></Modal>;
  const t = item;
  const terminal = t.status === "closed" || t.status === "cancelled";
  const st = ST[t.status];

  /** 统一状态流转：按来源路由到对应模块接口；回退提示词直接弹示。 */
  const act = async (action: string, extra?: object) => {
    try {
      const r = t.source === "device"
        ? await deviceApi.taskStatus(t.id, { action, ...extra })
        : await taskApi.status(t.id, { action, ...extra });
      message.success("已更新");
      const prompt = (r as { rollback_prompt?: string }).rollback_prompt;
      if (prompt) message.info(prompt, 5);
      onChanged?.();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const doAssign = async () => {
    if (!assignee) return;
    try {
      if (t.source === "device") await deviceApi.assignTask(t.id, assignee);
      else await taskApi.assign(t.id, assignee);
      message.success("已派发");
      onChanged?.();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "派发失败");
    }
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) { message.warning("标题不能为空"); return; }
    try {
      await taskApi.update(t.id, { title: editTitle.trim(), description: editDesc });
      message.success("已保存");
      setEditing(false);
      onChanged?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  /** 操作时间线（由任务字段推导）。 */
  const timeline = [
    ...(t.creator_name ? [{ color: "#5B7FFF", children: <>创建任务 · {t.creator_name}{t.created_at ? ` · ${t.created_at.slice(0, 16).replace("T", " ")}` : ""}</> }] : []),
    ...(t.assignee_name ? [{ color: "#3B5BDB", children: <>派发给 {t.assignee_name}</> }] : []),
    ...(t.completed_at ? [{ color: "#6D28D9", children: <>完成维修 · {t.completed_at.slice(0, 16).replace("T", " ")}</> }] : []),
    ...(t.verdict ? [{ color: "#22C55E", children: <>验收结论：{t.verdict}</> }] : []),
    ...(t.cancel_reason ? [{ color: "#EF4444", children: <>取消原因：{t.cancel_reason}</> }] : []),
  ];

  const claimHint = t.source === "device" && t.status === "pending" && t.dispatch_mode !== "manual" && !t.assignee_id;

  return (
    <Modal open onCancel={onClose} width={680} footer={null} title={<Space size={8}>任务详情<span style={{ fontSize: 12, fontWeight: 400, color: token.colorTextTertiary }}>{t.task_no}</span></Space>} destroyOnHidden>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
        {/* 基本信息 */}
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="类型">
            {t.source === "device"
              ? <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}>设备任务</Tag>
              : <Tag style={{ borderRadius: 999, background: "#FEF4E2", color: "#B45309", borderColor: "transparent", marginInlineEnd: 0 }}>线缆任务</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag style={{ borderRadius: 999, background: st?.bg, color: st?.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{st?.label ?? t.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="优先级">{t.priority === 2 ? <span style={{ color: "#DC2626", fontWeight: 600 }}>紧急</span> : t.priority === 1 ? <span style={{ color: "#B45309" }}>高优</span> : "普通"}</Descriptions.Item>
          <Descriptions.Item label="负责人">{t.assignee_name || (claimHint ? "待领取（公开任务单）" : "未派发")}</Descriptions.Item>
          <Descriptions.Item label="排期">{t.scheduled_time ? t.scheduled_time.slice(0, 16).replace("T", " ") : "—"}</Descriptions.Item>
          <Descriptions.Item label="创建人">{t.creator_name || "—"}</Descriptions.Item>
        </Descriptions>

        {/* 完整描述 */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary, marginBottom: 6 }}>完整描述</div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", background: "#F6F8FE", borderRadius: 10, padding: "10px 12px" }}>{t.description || "（未填写描述）"}</div>
        </div>

        {/* 关联设备/线缆详情 */}
        <div style={{ border: `1px solid ${token.colorBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary }}>关联信息</div>
          {t.source === "cable" && (t.fault_id || t.cable_name) ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
              {t.fault_id ? <>故障 #{t.fault_id}{t.fault_type ? ` · ${t.fault_type}` : ""}
                {t.fault_status != null && <Tag style={{ borderRadius: 999, marginInlineEnd: 0, background: FAULT_STATUS[t.fault_status]?.bg, color: FAULT_STATUS[t.fault_status]?.fg, borderColor: "transparent" }}>{FAULT_STATUS[t.fault_status]?.label ?? t.fault_status}</Tag>}</> : null}
              {t.cable_name ? <span style={{ color: token.colorTextSecondary }}>线缆：{t.cable_name}</span> : null}
              {t.fault_id && (
                <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate(`/cable/faults?focus=${t.fault_id}`)}>查看故障 ›</Button>
              )}
            </div>
          ) : null}
          {t.source === "device" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
              <span>设备：{t.device_name || "—"}{t.device_code ? `（${t.device_code}）` : ""}</span>
              {t.device_status != null && <Tag style={{ borderRadius: 999, marginInlineEnd: 0 }}>{DEVICE_STATUS[t.device_status]?.label ?? t.device_status}</Tag>}
              <span style={{ color: token.colorTextTertiary }}>快照回退目标：{t.previous_status ? DEVICE_STATUS[t.previous_status]?.label ?? "-" : "-"}</span>
              <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate(`/device/tasks?focus=d${t.id}`)}>查看设备维修任务 ›</Button>
            </div>
          ) : null}
        </div>

        {/* 操作时间线 */}
        {timeline.length > 0 && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary, marginBottom: 6 }}>操作历史</div>
            <Timeline items={timeline} />
          </div>
        )}

        {/* 维修记录 + 照片附件 */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary, marginBottom: 6 }}>维修记录 / 附件（{records.length}）</div>
          {records.length === 0 && <div style={{ fontSize: 12, color: token.colorTextTertiary }}>暂无维修记录</div>}
          {records.map((r) => (
            <div key={r.id} className="wlt-glass-sm" style={{ padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 13 }}>{r.content || "（无文字记录）"}</div>
              {(r.files?.length ?? 0) > 0 && (
                <Space wrap style={{ marginTop: 6 }}>
                  {r.files.map((f) => <img key={f.id} src={`/api/v1/files/${f.file_id}`} width={72} height={54} style={{ objectFit: "cover", borderRadius: 8 }} alt="" />)}
                </Space>
              )}
              <div style={{ fontSize: 11.5, color: token.colorTextTertiary, marginTop: 4 }}>{new Date(r.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>

        {/* 终态说明：不可回退 */}
        {terminal && (
          <div style={{ fontSize: 12, color: token.colorTextTertiary, background: "#F6F8FE", borderRadius: 10, padding: "8px 12px" }}>
            该任务已归档（{st?.label ?? t.status}）：仅可查看详情，不可再进行状态流转或回退；如需重开请重新发布任务并关联原{t.source === "device" ? "设备" : "故障"}。
          </div>
        )}

        {/* 操作区（按状态/权限渲染） */}
        {!terminal && (
          <div style={{ borderTop: `1px solid ${token.colorBorder}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {t.status === "pending" && !claimHint && isManager && (
              <Space wrap>
                <Select placeholder="选择维修人员" style={{ width: 240 }} value={assignee} onChange={setAssignee} options={workers.map((w) => ({ value: w.id, label: w.name }))} />
                <Button type="primary" disabled={!assignee} onClick={() => void doAssign()}>确认派发</Button>
              </Space>
            )}
            {claimHint && <div style={{ fontSize: 12, color: token.colorTextTertiary }}>公开任务单任务由维修人员在「设备维修任务」页自行领取。</div>}
            {t.status === "done" && (
              <Space direction="vertical" style={{ width: "100%" }} >
                <Input value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="验收结论（必填）" />
                <Space wrap>
                  <Button type="primary" disabled={!verdict.trim()} onClick={() => act("verify", { verdict })}>验收通过</Button>
                  <Popconfirm title="驳回该任务？" onConfirm={() => act("reject", { verdict: verdict.trim() || "驳回重做" })}>
                    <Button danger>驳回</Button>
                  </Popconfirm>
                </Space>
              </Space>
            )}
            {t.status === "verified" && (
              <Popconfirm title="关闭该任务？关闭后自动进入归档视图。" onConfirm={() => act("close")}>
                <Button type="primary">关闭任务</Button>
              </Popconfirm>
            )}
            {(t.status === "pending" || t.status === "assigned") && isManager && (
              <Space wrap>
                <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="取消原因（必填）" style={{ width: 240 }} />
                <Button danger disabled={!cancelReason.trim()} onClick={() => act("cancel", { reason: cancelReason.trim() })}>取消任务</Button>
              </Space>
            )}
            {t.source === "cable" && isManager && (
              editing ? (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="标题" maxLength={100} />
                  <Input.TextArea rows={2} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="描述" maxLength={500} />
                  <Space>
                    <Button type="primary" size="small" onClick={() => void saveEdit()}>保存</Button>
                    <Button size="small" onClick={() => setEditing(false)}>放弃编辑</Button>
                  </Space>
                </Space>
              ) : (
                <Button size="small" style={{ alignSelf: "flex-start" }} onClick={() => { setEditTitle(t.title); setEditDesc(t.description); setEditing(true); }}>编辑任务</Button>
              )
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
