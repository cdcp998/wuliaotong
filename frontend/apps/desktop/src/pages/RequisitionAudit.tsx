import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Input, Modal, Popconfirm, Select, Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { requisitionApi, FileImage, type RequisitionBill, type RequisitionDetail } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待完成工作", color: "gold" },
  2: { text: "待审计", color: "blue" },
  3: { text: "已完成", color: "green" },
  4: { text: "已驳回", color: "red" },
  5: { text: "已取消", color: "default" },
};

/** 领用审计（电脑端，仓管员）：主从布局——左侧待审计列表 + 右侧详情审计（《UI设计方案.md》§4.5）。 */
export function RequisitionAuditPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<number>(2);
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<RequisitionBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [remark, setRemark] = useState("");
  const [aiSum, setAiSum] = useState<{ summary: string; risk_level: string; reasons: string[]; ai: boolean } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [displayReason, setDisplayReason] = useState("");
  const [displayLocation, setDisplayLocation] = useState("");

  const load = useCallback(async (st: number, kw: string, pg: number) => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数瞬间 dataSource 与分页配置不匹配
    try {
      const data = await requisitionApi.list(st === 0 ? undefined : st, pg, "", pageSize);
      setList(
        data.list.filter((r) => !kw || r.bill_no.includes(kw) || r.use_location.includes(kw))
      );
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    void load(status, keyword, page);
  }, [status, keyword, page, pageSize, load]);

  async function openDetail(r: RequisitionBill) {
    try {
      const d = await requisitionApi.detail(r.id);
      setDetail(d);
      setRemark("");
      setDisplayReason(d.display_reason);
      setDisplayLocation(d.display_location);
      setAuditOpen(true);
      setAiSum(null);
      setAiLoading(true);
      requisitionApi.aiSummary(d.id).then(setAiSum).catch(() => setAiSum(null)).finally(() => setAiLoading(false));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }

  async function saveDisplay() {
    if (!detail) return;
    if (!displayReason.trim() || !displayLocation.trim()) return message.warning("对外显示信息不能为空");
    try {
      await requisitionApi.updateDisplay(detail.id, displayReason.trim(), displayLocation.trim());
      message.success("对外显示信息已更新");
      setDisplayOpen(false);
      const d = await requisitionApi.detail(detail.id);
      setDetail(d);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function audit(action: "approve" | "reject") {
    if (!detail) return;
    if (action === "reject" && !remark.trim()) return message.warning("驳回必须填写原因");
    setActing(true);
    try {
      await requisitionApi.audit(detail.id, action, remark.trim());
      message.success(action === "approve" ? "已通过：库存已扣减并通知申请人" : "已驳回并通知申请人");
      setAuditOpen(false);
      await load(status, keyword, page);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setActing(false);
    }
  }

  const columns: ColumnsType<RequisitionBill> = [
    { title: "单号", dataIndex: "bill_no", width: 150, render: (v, r) => <a onClick={() => void openDetail(r)}><b>{v}</b></a> },
    { title: "申请人", dataIndex: "applicant_name", width: 90 },
    { title: "使用地点", dataIndex: "use_location", width: 140 },
    {
      title: "因何使用",
      dataIndex: "use_reason",
      ellipsis: true,
      render: (v: string, r) =>
        r.is_private === 1 ? (
          <Space size={4}>
            <Tag color="red" style={{ marginRight: 0 }}>私用</Tag>
            <span title={v}>{v}</span>
          </Space>
        ) : (
          <span title={v}>{v}</span>
        ),
    },
    { title: "项数", width: 70, render: (_, r) => r.items.length },
    { title: "总数量", dataIndex: "total_qty", width: 90, align: "right" as const },
    { title: "申请时间", dataIndex: "created_at", width: 150, render: (v: string) => v.slice(0, 16) },
    {
      title: "状态",
      width: 90,
      render: (_, r) => <Tag color={STATUS[r.status]?.color}>{STATUS[r.status]?.text ?? r.status}</Tag>,
    },
    {
      title: "操作",
      width: 100,
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => void openDetail(r)}>
          查看详情
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: 0, marginBottom: 16 }}>领用审计</h2>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          style={{ width: 130 }}
          options={[
            { value: 0, label: "全部状态" },
            { value: 1, label: "待完成工作" },
            { value: 2, label: "待审计" },
            { value: 3, label: "已完成" },
            { value: 4, label: "已驳回" },
          ]}
        />
        <Input.Search
          placeholder="单号 / 使用地点"
          allowClear
          onSearch={(v) => {
            setKeyword(v);
            setPage(1);
          }}
          style={{ width: 240 }}
        />
        <span style={{ color: "#86909c", fontSize: 12 }}>流程：领用申请 → 完成工作拍照（含定位水印）→ 审计 → 完成 · 仅「待审计」可操作</span>
      </Space>
      <DataTable
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        size="middle"
        pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } }, showTotal: (t) => `共 ${t} 条` }}
       rowSelection
        batchActions={[
          { label: "批量通过", onClick: async (keys) => { for (const k of keys) await requisitionApi.audit(Number(k), "approve", ""); message.success(`已通过 ${keys.length} 张申请`); void load(status, keyword, page); } },
          { label: "批量驳回", danger: true, confirm: "确定驳回选中的领用申请吗？（库存将回补）", onClick: async (keys) => { for (const k of keys) await requisitionApi.audit(Number(k), "reject", "批量驳回"); message.success(`已驳回 ${keys.length} 张申请`); void load(status, keyword, page); } },
        ]} />

      <Drawer
        title={
          <span>
            领用申请审计 <Tag color={detail ? STATUS[detail.status]?.color : "default"}>{detail ? STATUS[detail.status]?.text : ""}</Tag>
          </span>
        }
        size={560}
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        destroyOnHidden
        extra={
          detail?.status === 2 ? (
            <Space>
              <Popconfirm title="确认驳回该申请？" onConfirm={() => void audit("reject")}>
                <Button danger disabled={acting}>驳 回</Button>
              </Popconfirm>
              <Popconfirm title="确认通过？将事务扣减库存并通知申请人" onConfirm={() => void audit("approve")}>
                <Button type="primary" disabled={acting}>通 过</Button>
              </Popconfirm>
            </Space>
          ) : undefined
        }
      >
        {detail && (
          <div>
            <div style={{ border: "1px solid #e5e6eb", borderRadius: 8, padding: 12, marginBottom: 12, background: "#fafbfc" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <b>AI 审核摘要</b>
                {aiLoading && <Tag>生成中…</Tag>}
                {aiSum && (
                  <Tag color={aiSum.risk_level === "高" ? "red" : aiSum.risk_level === "中" ? "orange" : "green"}>
                    风险：{aiSum.risk_level}
                  </Tag>
                )}
                {aiSum && !aiSum.ai && <Tag>规则版</Tag>}
              </div>
              {aiSum ? (
                <>
                  <Typography.Text>{aiSum.summary}</Typography.Text>
                  {aiSum.reasons.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                      {aiSum.reasons.map((r, i) => (
                        <li key={i} style={{ color: "#cf1322", fontSize: 12 }}>{r}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                !aiLoading && <Typography.Text type="secondary">摘要不可用（大模型未配置或生成失败）</Typography.Text>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 18px", background: "#fafbfc", border: "1px solid #f0f1f3", borderRadius: 8, padding: "12px 14px" }}>
              <div><div style={{ fontSize: 12, color: "#86909c" }}>单号</div><div style={{ fontWeight: 600 }}>{detail.bill_no}</div></div>
              <div><div style={{ fontSize: 12, color: "#86909c" }}>申请人</div><div>{detail.applicant_name}</div></div>
              <div><div style={{ fontSize: 12, color: "#86909c" }}>出库仓库</div><div>{detail.warehouse_name}</div></div>
              <div><div style={{ fontSize: 12, color: "#86909c" }}>申请时间</div><div>{detail.created_at.slice(0, 16)}</div></div>
              <div style={{ gridColumn: "1/-1" }}>
                <div style={{ fontSize: 12, color: "#86909c" }}>使用地点（必填）</div>
                <div style={{ fontWeight: 500 }}>{detail.use_location}</div>
              </div>
              <div style={{ gridColumn: "1/-1" }}>
                <div style={{ fontSize: 12, color: "#86909c" }}>因何使用（必填）</div>
                <div style={{ fontWeight: 500 }}>
                  {detail.use_reason}
                  {detail.is_private === 1 && <Tag color="red" style={{ marginLeft: 8 }}>私用</Tag>}
                </div>
              </div>
            </div>

            {detail.work_photo_file_id > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "#86909c", marginBottom: 6 }}>完成工作照片（工作地点留痕，下载时自动添加地点/时间/定位水印）</div>
                <Space>
                  <FileImage fileId={detail.work_photo_file_id} size={96} alt="完成工作照片" />
                  <div style={{ fontSize: 12, color: "#86909c" }}>
                    <div>{detail.work_done_at ? `完成时间：${detail.work_done_at.slice(0, 16)}` : ""}</div>
                    <div>{detail.work_lat ? `定位：${detail.work_lat}, ${detail.work_lng}` : "未获取定位"}</div>
                    <Button size="small" style={{ marginTop: 6 }} onClick={() => window.open(requisitionApi.workPhotoUrl(detail.id), "_self")}>
                      下载水印照片
                    </Button>
                  </div>
                </Space>
              </div>
            )}

            {detail.is_private === 1 && (
              <div style={{ background: "#fff1f0", border: "1px solid #ffccc7", borderRadius: 8, padding: "10px 12px", marginTop: 10, fontSize: 13 }}>
                <b style={{ color: "#cf1322" }}>⚠ 私用申请（特殊标记）</b>
                <div style={{ color: "#873800", marginTop: 4, lineHeight: 1.7 }}>
                  该申请已触发「私用」：因何使用锁定为「私用」且不可编辑；非管理员（含申请人）看到的「使用地点 / 因何使用」为下方固定话术，真实状态仅管理员可见。
                </div>
                <div style={{ marginTop: 6, background: "#fff", border: "1px solid #ffe7e6", borderRadius: 6, padding: "8px 10px", fontSize: 12.5 }}>
                  对外使用地点：<b>{detail.display_location}</b>　对外因何使用：<b>{detail.display_reason}</b>
                </div>
                <Button size="small" style={{ marginTop: 8 }} onClick={() => setDisplayOpen(true)}>
                  编辑对外显示信息
                </Button>
              </div>
            )}

            <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 8px" }}>领用明细（{detail.items.length} 项）</div>
            <DataTable
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.items}
              columns={[
                { title: "材料", dataIndex: "product_name", render: (v, r) => <div><b>{v}</b><div style={{ fontSize: 11, color: "#86909c" }}>{r.code}{r.spec ? ` / ${r.spec}` : ""}</div></div> },
                { title: "库位", dataIndex: "location_code", width: 110 },
                { title: "数量", dataIndex: "qty", width: 80, align: "right" as const },
                { title: "出库拍照", width: 90, render: (_, r) => (r.photo_file_id ? <Tag color="blue">已留痕</Tag> : <span style={{ color: "#c9cdd4" }}>未拍</span>) },
              ]}
            />

            {detail.status === 4 && detail.audit_remark && (
              <div style={{ background: "#fff1f0", border: "1px solid #ffccc7", color: "#cf1322", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
                驳回原因：{detail.audit_remark}
              </div>
            )}
            {detail.audit_name && detail.status === 3 && (
              <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", color: "#389e0d", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
                已由 {detail.audit_name} 于 {detail.audit_time?.slice(0, 16)} 审计通过，库存已扣减。
              </div>
            )}

            {detail.status === 2 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 8px" }}>审计操作</div>
                <Input.TextArea
                  rows={3}
                  placeholder="审计备注（驳回必填原因）"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                />
              </>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        title="编辑对外显示信息（私用申请）"
        open={displayOpen}
        onOk={() => void saveDisplay()}
        onCancel={() => setDisplayOpen(false)}
        okText="保存"
      >
        <div style={{ marginBottom: 12, fontSize: 12, color: "#86909c", lineHeight: 1.7 }}>
          以下内容将固定展示给非管理员（含申请人本人）作为「使用地点 / 因何使用」，真实状态仅管理员可见。
        </div>
        <Input
          placeholder="对外使用地点"
          value={displayLocation}
          onChange={(e) => setDisplayLocation(e.target.value)}
          maxLength={100}
          style={{ marginBottom: 12 }}
        />
        <Input
          placeholder="对外因何使用"
          value={displayReason}
          onChange={(e) => setDisplayReason(e.target.value)}
          maxLength={255}
        />
      </Modal>
    </div>
  );
}
