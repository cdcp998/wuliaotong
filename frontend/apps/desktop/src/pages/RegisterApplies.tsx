import { useCallback, useEffect, useState } from "react";
import { App, Button, Space, Tabs, Tag, theme } from "antd";
import type { ColumnsType } from "antd/es/table";

import { adminApi, type RegisterApply } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 状态胶囊（设计页 36 调色板：待审核橙/已通过绿/已驳回灰）。 */
const STATUS: Record<number, { text: string; bg: string; fg: string }> = {
  0: { text: "待审核", bg: "#FEF4E2", fg: "#B45309" },
  1: { text: "已通过", bg: "#E8F9EF", fg: "#15803D" },
  2: { text: "已拒绝", bg: "#EFF3FC", fg: "#64748B" },
};

/** 注册审核（电脑端，超管 sys:user）：审核注册模式下的账号开通申请。 */
export function RegisterAppliesPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [list, setList] = useState<RegisterApply[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<number | undefined>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
    const data = await adminApi.registerApplies(status, page, pageSize);
    setList(data.list);
    setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [status, page, pageSize]);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  async function doApprove(r: RegisterApply) {
    try {
      const d = await adminApi.approveRegisterApply(r.id);
      message.success(d.message);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function doReject(r: RegisterApply) {
    try {
      const d = await adminApi.rejectRegisterApply(r.id);
      message.success(d.message);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  const columns: ColumnsType<RegisterApply> = [
    { title: "时间", dataIndex: "created_at", width: 160 },
    { title: "登录名", dataIndex: "username", width: 120 },
    { title: "姓名", dataIndex: "real_name", width: 110 },
    { title: "手机", dataIndex: "phone", width: 130 },
    { title: "邮箱", dataIndex: "email", width: 180 },
    { title: "状态", width: 90, render: (_, r) => {
      const s = STATUS[r.status];
      return <Tag style={{ borderRadius: 999, background: s.bg, color: s.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{s.text}</Tag>;
    } },
    {
      title: "操作",
      width: 160,
      render: (_, r) =>
        r.status === 0 ? (
          <Space>
            <Button size="small" type="primary" onClick={() => void doApprove(r)}>通过</Button>
            <Button size="small" danger onClick={() => void doReject(r)}>拒绝</Button>
          </Space>
        ) : (
          "-"
        ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 36）：标题+副题 */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>注册审核</h2>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
          审核注册模式下，新用户提交的注册申请在此处理；通过后账号即为「使用者」角色
        </p>
      </div>
      {/* 状态 Tabs（设计页 36：待审核/已通过/已驳回，全局胶囊样式） */}
      <Tabs
        activeKey={String(status ?? 0)}
        onChange={(k) => {
          setStatus(Number(k));
          setPage(1);
        }}
        items={[
          { key: "0", label: "待审核" },
          { key: "1", label: "已通过" },
          { key: "2", label: "已驳回" },
        ]}
        style={{ marginBottom: 12 }}
      />
      {/* 表格卡 */}
      <div className="wlt-glass" style={{ padding: 12 }}>
        <DataTable rowKey="id" loading={loading} size="small" columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}  rowSelection
          batchActions={[
            { label: "批量通过", onClick: async (keys) => { for (const k of keys) await adminApi.approveRegisterApply(Number(k)); message.success(`已通过 ${keys.length} 条申请`); void load(); } },
            { label: "批量拒绝", danger: true, confirm: "确定拒绝选中的注册申请吗？", onClick: async (keys) => { for (const k of keys) await adminApi.rejectRegisterApply(Number(k)); message.success(`已拒绝 ${keys.length} 条申请`); void load(); } },
          ]} />
      </div>
    </div>
  );
}
