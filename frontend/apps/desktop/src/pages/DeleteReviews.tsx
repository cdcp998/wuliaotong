import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Popconfirm, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AuditOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";

import { baseApi, useAuthStore, type DeleteReview } from "@wlt/shared";

const PAGE_SIZE = 20;

/**
 * 删除审核（电脑端）：物料/分类删除审批流 —— 待审核列表由管理者及以上角色审核。
 * 通过后执行删除（材料=停用，分类=物理删除仍受子分类/材料保护）；驳回则不做任何改动。
 */
export function DeleteReviewsPage() {
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);
  const isManager = user?.role?.code === "super_admin" || user?.role?.code === "manager";

  const [status, setStatus] = useState<number>(0); // 0 待审核 / 1 已通过 / 2 已驳回
  const [list, setList] = useState<DeleteReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  // 驳回弹窗
  const [rejecting, setRejecting] = useState<DeleteReview | null>(null);
  const [rejectRemark, setRejectRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await baseApi.deleteReviews(status, page, PAGE_SIZE);
      setList(d.list);
      setTotal(d.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [status, page, message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  async function approve(r: DeleteReview) {
    setSubmitting(true);
    try {
      const done = await baseApi.approveDeleteReview(r.id);
      message.success(
        done.status === 1
          ? `已通过：${r.biz_type === "product" ? "材料" : "分类"}「${r.target_name}」已删除`
          : `该申请审核未通过（分类下仍有子分类或材料），已自动驳回`
      );
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function reject(r: DeleteReview) {
    const remark = rejectRemark.trim();
    if (!remark) {
      message.warning("请填写驳回理由（通知申请人）");
      return;
    }
    setSubmitting(true);
    try {
      await baseApi.rejectDeleteReview(r.id, remark);
      message.success(`已驳回「${r.target_name}」的删除申请`);
      setRejecting(null);
      setRejectRemark("");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  const columns: ColumnsType<DeleteReview> = useMemo(
    () => [
      {
        title: "类型",
        dataIndex: "biz_type",
        width: 80,
        render: (v: string) => (v === "product" ? <Tag color="blue">材料</Tag> : v === "category" ? <Tag color="orange">分类</Tag> : <Tag color="purple">故障</Tag>),
      },
      { title: "目标", dataIndex: "target_name", width: 180, ellipsis: true, render: (v: string, r) => <span title={r.target_desc}>{v}</span> },
      { title: "删除原因", dataIndex: "reason", width: 220, ellipsis: true },
      { title: "申请人", dataIndex: "applicant_name", width: 110 },
      { title: "申请时间", dataIndex: "created_at", width: 150, render: (v?: string) => (v ? v.slice(0, 16) : "-") },
      ...(status === 0
        ? ([
            {
              title: "操作",
              key: "op",
              width: 150,
              render: (_: unknown, r: DeleteReview) =>
                isManager ? (
                  <Space size={4}>
                    <Popconfirm
                      title={`确认通过并删除「${r.target_name}」？`}
                      description={r.biz_type === "product" ? "材料将被停用（可再启用）" : r.biz_type === "category" ? "分类将被删除（有子分类或材料时自动驳回）" : "故障将被软删除（地图/列表不再显示，数据保留可追溯）"}
                      okText="通过"
                      onConfirm={() => void approve(r)}
                    >
                      <Button size="small" type="primary" icon={<CheckOutlined />}>通过</Button>
                    </Popconfirm>
                    <Button size="small" danger icon={<CloseOutlined />} onClick={() => { setRejecting(r); setRejectRemark(""); }}>
                      驳回
                    </Button>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">仅管理者及以上可审核</Typography.Text>
                ),
            },
          ] as ColumnsType<DeleteReview>)
        : ([
            {
              title: "审核结果",
              key: "result",
              width: 220,
              render: (_: unknown, r: DeleteReview) => (
                <Space size={4} wrap>
                  {r.status === 1 ? <Tag color="green">已删除</Tag> : <Tag color="red">已驳回</Tag>}
                  {r.review_remark ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.review_remark}</Typography.Text> : null}
                </Space>
              ),
            },
          ] as ColumnsType<DeleteReview>)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, isManager]
  );

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>删除审核</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#646a73" }}>
            物料/分类/已关闭故障删除审批流：仓管员及以上提交删除申请，管理者及以上审核通过后才执行删除；审核结果站内通知申请人
          </p>
        </div>
        <Button icon={<AuditOutlined />} onClick={() => void load()}>刷新</Button>
      </div>

      {!isManager && (
        <div style={{ marginBottom: 12, fontSize: 12.5, color: "#646a73" }}>
          <Tag color="orange">当前为 {user?.role?.name ?? "未知角色"}：可查看删除申请进度，审核操作需管理者及以上角色</Tag>
        </div>
      )}

      <Tabs
        activeKey={String(status)}
        onChange={(k) => setStatus(Number(k))}
        items={[
          { key: "0", label: "待审核" },
          { key: "1", label: "已通过" },
          { key: "2", label: "已驳回" },
        ]}
      />

      <Table<DeleteReview>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={list}
        loading={loading}
        locale={{ emptyText: "暂无删除申请" }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => setPage(p),
        }}
      />

      {/* 驳回弹窗 */}
      <Modal
        title={`驳回删除申请：${rejecting?.target_name ?? ""}`}
        open={Boolean(rejecting)}
        onOk={() => rejecting && void reject(rejecting)}
        okText="驳回"
        okButtonProps={{ danger: true }}
        confirmLoading={submitting}
        onCancel={() => setRejecting(null)}
        width={440}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, fontSize: 13, color: "#646a73" }}>
          删除原因（申请人填写）：{rejecting?.reason}
        </div>
        <Input.TextArea
          rows={3}
          maxLength={500}
          placeholder="请填写驳回理由（必填，站内通知申请人）"
          value={rejectRemark}
          onChange={(e) => setRejectRemark(e.target.value)}
        />
      </Modal>
    </div>
  );
}
