import { useEffect, useState } from "react";
import { Badge, List, NavBar, Tabs, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { checkApi, type CheckBill } from "@wlt/shared";

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

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/")}>库存盘点</NavBar>
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
            arrow="horizontal"
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
    </div>
  );
}
