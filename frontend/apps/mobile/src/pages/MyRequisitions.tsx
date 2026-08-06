import { useEffect, useState } from "react";
import { List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { requisitionApi, type RequisitionBill } from "@wlt/shared";

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待审计", color: "warning" },
  2: { text: "已通过", color: "success" },
  3: { text: "已驳回", color: "danger" },
  4: { text: "已取消", color: "default" },
};

/** 我的申请列表（使用者手机端）。 */
export function MyRequisitionsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<RequisitionBill[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    requisitionApi
      .my()
      .then((d) => setList(d.list))
      .catch((e) => Toast.show(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/")}>我的申请</NavBar>
      <List>
        {list.map((r) => (
          <List.Item
            key={r.id}
            onClick={() => navigate(`/requisitions/${r.id}`)}
            description={`${r.warehouse_name} · ${r.use_location} · ${r.created_at.slice(0, 16)} · ${r.items.length} 项`}
            extra={<Tag color={STATUS[r.status]?.color}>{STATUS[r.status]?.text ?? r.status}</Tag>}
          >
            <div>
              {r.bill_no}
              <span style={{ marginLeft: 8, color: "#666" }}>{r.use_reason}</span>
            </div>
            {r.status === 3 && r.audit_remark && (
              <div style={{ color: "#ff4d4f", fontSize: 12, marginTop: 4 }}>驳回原因：{r.audit_remark}</div>
            )}
          </List.Item>
        ))}
        {!loading && !list.length && <List.Item>暂无申请记录</List.Item>}
        <List.Item onClick={() => navigate("/requisitions/new")} arrow="horizontal">
          + 新建领用申请
        </List.Item>
      </List>
    </div>
  );
}
