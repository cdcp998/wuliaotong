import { useCallback, useEffect, useRef, useState } from "react";
import { InfiniteScroll, List, NavBar, SpinLoading, Tag, Toast } from "antd-mobile";
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

/** 我的申请列表（使用者手机端）。分页：首屏 20 条 + 上拉加载更多。 */
export function MyRequisitionsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<RequisitionBill[]>([]);
  const [loading, setLoading] = useState(true); // 首屏加载中
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    let alive = true;
    requisitionApi
      .my(undefined, 1)
      .then((d) => {
        if (!alive) return;
        setList(d.list);
        pageRef.current = 1;
        setHasMore(d.list.length < d.total);
      })
      .catch((e) => Toast.show(e instanceof Error ? e.message : "加载失败"))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const d = await requisitionApi.my(undefined, next);
      setList((ls) => [...ls, ...d.list]);
      pageRef.current = next;
      setHasMore(next * PAGE_SIZE < d.total);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  return (
    <div style={{ minHeight: "100dvh", background: "#f5f6f8" }}>
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
            {r.status === 4 && r.audit_remark && (
              <div style={{ color: "#ff4d4f", fontSize: 12, marginTop: 4 }}>驳回原因：{r.audit_remark}</div>
            )}
          </List.Item>
        ))}
        {loading && (
          <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
            <SpinLoading />
          </div>
        )}
        {!loading && !list.length && <List.Item>暂无申请记录</List.Item>}
        <List.Item onClick={() => navigate("/requisitions/new")} arrow="horizontal">
          + 新建领用申请
        </List.Item>
      </List>
      {hasMore && (
        <InfiniteScroll loadMore={loadMore} hasMore={hasMore} threshold={80}>
          {loadingMore ? <SpinLoading style={{ "--size": "18px" } as React.CSSProperties} /> : undefined}
        </InfiniteScroll>
      )}
    </div>
  );
}
