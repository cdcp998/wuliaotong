/** task 模块：任务详情弹窗——点击看板简略卡片弹出，展示完整信息。
 *  含：完整描述、关联设备/线缆详情（跨模块跳转）、参与留痕时间线（谁领取/领料/完成）、
 *  维修记录与照片附件；v2 无锁协作制操作按钮：待领取→「领取并处理」（维修人员均可）、
 *  进行中→「完成任务」（图片可选）；done→后台审核（通过即归档/驳回带理由退回参与者）；
 *  终态只读。支持关闭按钮 / 点击遮罩 / Esc 关闭。 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Descriptions, Input, Modal, Popconfirm, Space, Tag, Timeline, theme } from "antd";

import { useAuthStore } from "@wlt/shared";

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
  // v2 无锁协作：后台角色可代办；维修人员（repairer）可领取/处理/完成
  const isManager = ["super_admin", "manager", "dispatcher"].includes(me?.role?.code ?? "");
  const canProcess = isManager || me?.role?.code === "repairer";
  const [verdict, setVerdict] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  /** 维修记录（两来源结构取交集：id/content/created_at/files[{id,file_id}]）。 */
  const [records, setRecords] = useState<{ id: number; content: string; created_at: string; files: { id: number; file_id: number }[] }[]>([]);

  // 打开时拉取维修记录（含照片附件）；失败静默（无记录展示）
  useEffect(() => {
    setRecords([]);
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

  /** 统一状态流转：按来源路由到对应模块接口。 */
  const act = async (action: string, extra?: object) => {
    try {
      if (t.source === "device") await deviceApi.taskStatus(t.id, { action, ...extra });
      else await taskApi.status(t.id, { action, ...extra });
      message.success("已更新");
      onChanged?.();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
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

  /** 操作时间线：字段推导 + 参与留痕事件（谁领取/谁领料/谁完成）。 */
  const timeline = [
    ...(t.creator_name ? [{ color: "#5B7FFF", children: <>发布任务 · {t.creator_name}{t.created_at ? ` · ${t.created_at.slice(0, 16).replace("T", " ")}` : ""}</> }] : []),
    ...(t.events ?? []).map((e) => ({
      color: e.action === "claim" ? "#3B5BDB" : e.action === "requisition" ? "#0E7490" : "#8B5CF6",
      children: <>{e.name} · {e.action_label}{e.created_at ? ` · ${e.created_at.slice(0, 16).replace("T", " ")}` : ""}</>,
    })),
    ...(t.completed_at ? [{ color: "#6D28D9", children: <>完成时间 · {t.completed_at.slice(0, 16).replace("T", " ")}</> }] : []),
    ...(t.verdict ? [{ color: "#22C55E", children: <>审核结论：{t.verdict}</> }] : []),
    ...(t.cancel_reason ? [{ color: "#EF4444", children: <>取消原因：{t.cancel_reason}</> }] : []),
  ];

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
          <Descriptions.Item label="主责">{t.assignee_name || "未定（首位领取人）"}</Descriptions.Item>
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
              <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate(`/device/tasks?focus=d${t.id}`)}>查看设备故障管理 ›</Button>
            </div>
          ) : null}
        </div>

        {/* 参与留痕 + 操作历史时间线 */}
        {timeline.length > 0 && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: token.colorTextSecondary, marginBottom: 6 }}>
              过程留痕
            </div>
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
            该任务已进入任务历史（{st?.label ?? t.status}）：仅可查看详情，不可再进行状态流转；如需重开请重新发布任务并关联原{t.source === "device" ? "设备" : "故障"}。
          </div>
        )}

        {/* 操作区（v2 无锁协作制，按状态/权限渲染） */}
        {!terminal && (
          <div style={{ borderTop: `1px solid ${token.colorBorder}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {t.status === "pending" && canProcess && (
              <Popconfirm title="领取并处理该任务？" onConfirm={() => act("claim")}>
                <Button type="primary">领取并处理</Button>
              </Popconfirm>
            )}
            {t.status === "in_progress" && canProcess && (
              <Popconfirm title="确认处理完毕？（上传图片可选）任务将进入待审核。" onConfirm={() => act("complete")}>
                <Button type="primary">处理完毕</Button>
              </Popconfirm>
            )}
            {t.status === "done" && isManager && (
              <Space orientation="vertical" style={{ width: "100%" }} >
                <Input value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="审核结论 / 驳回理由（必填）" />
                <Space wrap>
                  <Popconfirm title="审核通过？任务将归档进入任务历史。" onConfirm={() => act("verify", { verdict })}>
                    <Button type="primary" disabled={!verdict.trim()}>审核通过（归档）</Button>
                  </Popconfirm>
                  <Popconfirm title="驳回该任务？将带理由退回全部参与人重做。" onConfirm={() => act("reject", { verdict })}>
                    <Button danger disabled={!verdict.trim()}>驳回（退回重做）</Button>
                  </Popconfirm>
                </Space>
              </Space>
            )}
            {(t.status === "pending" || t.status === "in_progress") && isManager && (
              <Space wrap>
                <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="取消原因（必填）" style={{ width: 240 }} />
                <Button danger disabled={!cancelReason.trim()} onClick={() => act("cancel", { reason: cancelReason.trim() })}>取消任务</Button>
              </Space>
            )}
            {t.source === "cable" && isManager && (
              editing ? (
                <Space orientation="vertical" style={{ width: "100%" }}>
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
