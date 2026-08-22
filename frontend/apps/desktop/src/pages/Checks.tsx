import { useCallback, useEffect, useState } from "react";
import { App, Button, Modal, Popconfirm, Radio, Select, Space, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router";
import { ProfileOutlined, ClockCircleOutlined, CalendarOutlined, RiseOutlined, FallOutlined } from "@ant-design/icons";

import { baseApi, checkApi, type CheckBill } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

const STATUS: Record<number, string> = { 0: "待盘点", 1: "盘点中", 2: "已审核" };

/** 盘点统计卡数据（设计页 24：进行中/待过账/本月/盈亏）。 */
interface CheckStats {
  inProgress: number;
  pending: number;
  monthCount: number;
  gain: number;
  loss: number;
}

export function ChecksPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [status, setStatus] = useState<number | undefined>();
  const [list, setList] = useState<CheckBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [whId, setWhId] = useState<number | undefined>();
  const [stats, setStats] = useState<CheckStats>({ inProgress: 0, pending: 0, monthCount: 0, gain: 0, loss: 0 });

  const load = useCallback(async () => {
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    const data = await checkApi.list(status, page, pageSize);
    setList(data.list);
    setTotal(data.total);
  }, [status, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // 盘点统计卡：分页取全量盘点单，按明细 diff_qty 汇总盈亏
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all: CheckBill[] = [];
        for (let p = 1; p <= 5; p++) {
          const d = await checkApi.list(undefined, p, 100);
          all.push(...d.list);
          if (all.length >= d.total || d.list.length === 0) break;
        }
        if (!alive) return;
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        let gain = 0;
        let loss = 0;
        for (const b of all) {
          if (b.status === 2) {
            for (const it of b.items) {
              const d = Number(it.diff_qty) || 0;
              if (d > 0) gain += d;
              else if (d < 0) loss += Math.abs(d);
            }
          }
        }
        setStats({
          inProgress: all.filter((b) => b.status === 1).length,
          pending: all.filter((b) => b.status === 0).length,
          monthCount: all.filter((b) => b.check_date?.startsWith(month)).length,
          gain,
          loss,
        });
      } catch {
        /* 统计失败不影响主列表 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [total]);

  useEffect(() => {
    baseApi.warehouses().then((ws) => setWarehouses(ws.filter((w) => w.status === 1).map((w) => ({ id: w.id, name: w.name }))));
  }, []);

  async function create() {
    if (!whId) return message.warning("请选择盘点仓库");
    try {
      const data = await checkApi.create(whId);
      message.success(`盘点单 ${data.bill_no} 已创建（自动带出账面明细）`);
      setOpen(false);
      navigate(`/checks/${data.id}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  }

  const columns: ColumnsType<CheckBill> = [
    { title: "单号", dataIndex: "bill_no", render: (v: string, r) => <a onClick={() => navigate(`/checks/${r.id}`)}>{v}</a> },
    { title: "仓库", dataIndex: "warehouse_name" },
    { title: "状态", dataIndex: "status", render: (s: number) => STATUS[s] ?? s },
    { title: "明细数", render: (_, r) => r.items.length },
    { title: "盘点时间", dataIndex: "check_date" },
    {
      title: "操作",
      render: (_, r) => (
        <Space>
          <Button size="small" type="primary" onClick={() => navigate(`/checks/${r.id}`)}>
            {r.status === 2 ? "查看" : "执行盘点"}
          </Button>
          {r.status === 1 && (
            <PopconfirmButton id={r.id} />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>盘点</h2>

      {/* 统计卡（设计页 24：进行中/待过账/本月/盈亏） */}
      <div className="wlt-grid" style={{ marginBottom: 16 }}>
        {[
          { icon: <ClockCircleOutlined />, label: "进行中", value: stats.inProgress, color: "#3B5BDB", bg: "#EAEFFF" },
          { icon: <ProfileOutlined />, label: "待过账", value: stats.pending, color: "#B45309", bg: "#FEF4E2" },
          { icon: <CalendarOutlined />, label: "本月盘点", value: stats.monthCount, color: "#1E2433", bg: "#F6F8FE" },
          { icon: <RiseOutlined />, label: "盘盈", value: stats.gain.toLocaleString("zh-CN", { maximumFractionDigits: 3 }), color: "#15803D", bg: "#E8F9EF" },
          { icon: <FallOutlined />, label: "盘亏", value: stats.loss.toLocaleString("zh-CN", { maximumFractionDigits: 3 }), color: "#DC2626", bg: "#FDEBEC" },
        ].map((c) => (
          <div key={c.label} className="wlt-glass-sm" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 12, background: c.bg, color: c.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{c.icon}</span>
            <div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
            </div>
          </div>
        ))}
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Radio.Group value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} optionType="button" size="small">
          <Radio.Button value={undefined}>全部</Radio.Button>
          <Radio.Button value={0}>待盘点</Radio.Button>
          <Radio.Button value={1}>盘点中</Radio.Button>
          <Radio.Button value={2}>已审核</Radio.Button>
        </Radio.Group>
        <Button type="primary" onClick={() => setOpen(true)}>新建盘点单</Button>
      </Space>
      <DataTable rowKey="id" locale={{ emptyText: "暂无数据" }} columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}  rowSelection onBatchDelete={async () => { message.info("该列表为只读数据，不支持删除"); }} />

      <Modal title="新建盘点单" open={open} onOk={() => void create()} onCancel={() => setOpen(false)}>
        <Select style={{ width: "100%" }} placeholder="选择盘点仓库" options={warehouses} fieldNames={{ label: "name", value: "id" }} value={whId} onChange={setWhId} />
        <p style={{ color: "#5B6478", fontSize: 12 }}>创建后自动带出该仓库全部库存物品（按物品汇总账面数量），逐项录入实盘数量。</p>
      </Modal>
    </div>
  );
}

function PopconfirmButton({ id }: { id: number }) {
  const { message } = App.useApp();
  return (
    <Popconfirm
      title="确认审核？将按盘盈/盘亏生成库存流水"
      onConfirm={async () => {
        try {
          await checkApi.audit(id);
          message.success("已审核");
          window.location.reload();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "审核失败");
        }
      }}
    >
      <Button size="small" type="primary" ghost>审核</Button>
    </Popconfirm>
  );
}
