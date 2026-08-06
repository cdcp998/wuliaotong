import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Input, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { requisitionApi, type RequisitionBill, type RequisitionDetail } from "@wlt/shared";

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待审计", color: "gold" },
  2: { text: "已通过", color: "green" },
  3: { text: "已驳回", color: "red" },
  4: { text: "已取消", color: "default" },
};

/** 领用审计（电脑端，仓管员）：主从布局——左侧待审计列表 + 右侧详情审计（《UI设计方案.md》§4.5）。 */
export function RequisitionAuditPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<number>(1);
  const [keyword, setKeyword] = useState("");
  const [list, setList] = useState<RequisitionBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [remark, setRemark] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async (st: number, kw: string, pg: number) => {
    setLoading(true);
    try {
      const data = await requisitionApi.list(st === 0 ? undefined : st, pg);
      setList(
        data.list.filter((r) => !kw || r.bill_no.includes(kw) || r.use_location.includes(kw))
      );
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status, keyword, page);
  }, [status, keyword, page, load]);

  async function openDetail(r: RequisitionBill) {
    try {
      const d = await requisitionApi.detail(r.id);
      setDetail(d);
      setRemark("");
      setAuditOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
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
      render: (v: string) => <span title={v}>{v}</span>,
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
            { value: 1, label: "待审计" },
            { value: 2, label: "已通过" },
            { value: 3, label: "已驳回" },
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
        <span style={{ color: "#86909c", fontSize: 12 }}>通过 = 事务内锁库存校验并扣减 · 驳回 = 申请人可修改后重新提交</span>
      </Space>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        size="middle"
        pagination={{ current: page, pageSize: 20, total, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
      />

      <Drawer
        title={
          <span>
            领用申请审计 <Tag color={detail ? STATUS[detail.status]?.color : "default"}>{detail ? STATUS[detail.status]?.text : ""}</Tag>
          </span>
        }
        width={560}
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        destroyOnHidden
        extra={
          detail?.status === 1 ? (
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
                <div style={{ fontWeight: 500 }}>{detail.use_reason}</div>
              </div>
            </div>

            <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 8px" }}>领用明细（{detail.items.length} 项）</div>
            <Table
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

            {detail.status === 3 && detail.audit_remark && (
              <div style={{ background: "#fff1f0", border: "1px solid #ffccc7", color: "#cf1322", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
                驳回原因：{detail.audit_remark}
              </div>
            )}
            {detail.audit_name && detail.status === 2 && (
              <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", color: "#389e0d", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginTop: 12 }}>
                已由 {detail.audit_name} 于 {detail.audit_time?.slice(0, 16)} 审计通过，库存已扣减。
              </div>
            )}

            {detail.status === 1 && (
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
    </div>
  );
}
