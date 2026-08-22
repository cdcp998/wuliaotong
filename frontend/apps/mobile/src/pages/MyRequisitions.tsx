import { useCallback, useEffect, useRef, useState } from "react";
import { InfiniteScroll, List, NavBar, SpinLoading, Tabs, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { requisitionApi, type RequisitionBill } from "@wlt/shared";

const PAGE_SIZE = 20;

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待完成工作", color: "warning" },
  2: { text: "待审计", color: "primary" },
  3: { text: "已完成", color: "success" },
  4: { text: "已驳回", color: "danger" },
  5: { text: "已取消", color: "default" },
};

// 状态 Tabs（设计页 M10）：undefined=全部；1 待完成 / 2 待审计 / 3 已完成 / 4 已驳回
const TABS: { key: string; label: string; value: number | undefined }[] = [
  { key: "all", label: "全部", value: undefined },
  { key: "s1", label: "待完成工作", value: 1 },
  { key: "s2", label: "待审计", value: 2 },
  { key: "s3", label: "已完成", value: 3 },
  { key: "s4", label: "已驳回", value: 4 },
];

/** 我的申请列表（使用者手机端）。状态 Tabs 过滤 + 分页（首屏 20 + 上拉加载更多）。 */
export function MyRequisitionsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const status = TABS.find((t) => t.key === tab)?.value;
  const [list, setList] = useState<RequisitionBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async (st: number | undefined) => {
    setLoading(true);
    try {
      const d = await requisitionApi.my(st, 1);
      setList(d.list);
      pageRef.current = 1;
      setHasMore(d.list.length < d.total);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const d = await requisitionApi.my(status, next);
      setList((ls) => [...ls, ...d.list]);
      pageRef.current = next;
      setHasMore(next * PAGE_SIZE < d.total);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [status]);

  return (
    <div className="wlt-page-enter" style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar onBack={() => navigate("/")}>我的申请</NavBar>
      {/* 状态 Tabs（设计页 M10） */}
      <Tabs activeKey={tab} onChange={setTab} style={{ background: "rgba(255,255,255,.92)", backdropFilter: "blur(8px)" }}>
        {TABS.map((t) => (
          <Tabs.Tab key={t.key} title={t.label} />
        ))}
      </Tabs>
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
            {r.status === 4 && r.audit_remark && (
              <div style={{ color: "#EF4444", fontSize: 12, marginTop: 4 }}>驳回原因：{r.audit_remark}</div>
            )}
          </List.Item>
        ))}
        {loading && (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
            <SpinLoading />
          </div>
        )}
        {!loading && !list.length && <List.Item>暂无申请记录</List.Item>}
        {tab === "all" && (
          <List.Item onClick={() => navigate("/requisitions/new")}>
            + 新建领用申请
          </List.Item>
        )}
      </List>
      {hasMore && (
        <InfiniteScroll loadMore={loadMore} hasMore={hasMore} threshold={80}>
          {loadingMore ? <SpinLoading style={{ "--size": "18px" } as React.CSSProperties} /> : undefined}
        </InfiniteScroll>
      )}
    </div>
  );
}
