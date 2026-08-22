import { useEffect, useState } from "react";
import { Badge, Button, List, Modal, NavBar, Selector, Tabs, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { baseApi, checkApi, type CheckBill } from "@wlt/shared";

const STATUS_TABS = [
  { key: "all", title: "全部" },
  { key: "0", title: "待盘点" },
  { key: "1", title: "盘点中" },
  { key: "2", title: "已审核" },
];

const STATUS_TEXT: Record<number, { text: string; color: string }> = {
  0: { text: "待盘点", color: "default" },
  1: { text: "盘点中", color: "primary" },
  2: { text: "已审核", color: "success" },
};

export function ChecksPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [list, setList] = useState<CheckBill[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [whId, setWhId] = useState<number>();

  async function load(status: string) {
    setLoading(true);
    try {
      const data = await checkApi.list(status === "all" ? undefined : Number(status));
      setList(data.list);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(tab);
  }, [tab]);

  function openCreate() {
    baseApi
      .warehouses()
      .then((ws) => setWarehouses(ws.filter((w) => w.status === 1).map((w) => ({ id: w.id, name: w.name }))))
      .catch(() => undefined);
    setWhId(undefined);
    setOpen(true);
  }

  async function create() {
    if (!whId) return Toast.show("请选择盘点仓库");
    try {
      const data = await checkApi.create(whId);
      Toast.show(`盘点单 ${data.bill_no} 已创建`);
      setOpen(false);
      navigate(`/checks/${data.id}`);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "创建失败");
    }
  }

  return (
    <div className="wlt-page-enter" style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar
        onBack={() => navigate("/")}
        right={
          <Button size="mini" color="primary" onClick={openCreate}>
            发起盘点
          </Button>
        }
      >
        库存盘点
      </NavBar>
      <Tabs activeKey={tab} onChange={setTab}>
        {STATUS_TABS.map((t) => (
          <Tabs.Tab key={t.key} title={t.title} />
        ))}
      </Tabs>
      <List>
        {list.map((c) => (
          <List.Item
            key={c.id}
            onClick={() => navigate(`/checks/${c.id}`)}
            description={`${c.warehouse_name} · ${c.check_date.slice(0, 16)} · ${c.items.length} 项`}
            extra={
              <Tag color={STATUS_TEXT[c.status]?.color}>{STATUS_TEXT[c.status]?.text ?? c.status}</Tag>
            }
          >
            <Badge content={c.status === 1 ? "进行中" : undefined}>{c.bill_no}</Badge>
          </List.Item>
        ))}
        {!loading && !list.length && <List.Item>暂无盘点单</List.Item>}
      </List>

      <Modal
        visible={open}
        title="发起盘点"
        content={
          <div>
            <div style={{ fontSize: 13, color: "#5B6478", marginBottom: 10 }}>
              选择要盘点的仓库，创建后自动带出该仓库全部库存物品（按物品汇总账面数量），手机/电脑均可录入实盘。
            </div>
            <Selector
              options={warehouses.map((w) => ({ label: w.name, value: w.id }))}
              value={whId ? [whId] : []}
              onChange={(arr) => setWhId(arr[0] as number | undefined)}
            />
          </div>
        }
        onClose={() => setOpen(false)}
        actions={[
          { key: "cancel", text: "取消", onClick: () => setOpen(false) },
          { key: "create", text: "创建盘点单", primary: true, onClick: () => void create() },
        ]}
      />
    </div>
  );
}
