import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, List, NavBar, Tag, TextArea, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { requisitionApi, type RequisitionBill, type RequisitionDetail } from "@wlt/shared";

/** 领用审计（手机端，仓管员）：待审计领用单列表 → 明细 → 通过/驳回（与桌面端同一接口）。
 * 审计通过仅确认状态（库存已在提交时自动扣减）；驳回自动回补库存。 */
export function RequisitionAuditPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<RequisitionBill[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<RequisitionDetail | null>(null);
  const [acting, setActing] = useState(false);
  const rejectRemarkRef = useRef(""); // 驳回原因（Dialog 内输入）

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await requisitionApi.list(2, 1, "", 50); // 仅待审计
      setList(d.list);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openBill(b: RequisitionBill) {
    try {
      const d = await requisitionApi.detail(b.id);
      setSel(d);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    }
  }

  async function doApprove() {
    if (!sel || acting) return;
    setActing(true);
    try {
      await requisitionApi.audit(sel.id, "approve", "同意");
      Toast.show("已通过");
      setSel(null);
      await load();
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    } finally {
      setActing(false);
    }
  }

  function doReject() {
    if (!sel || acting) return;
    rejectRemarkRef.current = "";
    Dialog.confirm({
      title: "驳回领用单？",
      content: (
        <div style={{ textAlign: "center", paddingTop: 4 }}>
          <TextArea
            placeholder="驳回原因（必填）"
            maxLength={200}
            rows={3}
            onChange={(v) => {
              rejectRemarkRef.current = v;
            }}
            style={{ background: "#F2F5FB", borderRadius: 12, padding: 8, "--font-size": "14px" } as React.CSSProperties}
          />
        </div>
      ),
      confirmText: "确认驳回",
      cancelText: "取消",
      onConfirm: async () => {
        if (!rejectRemarkRef.current.trim()) {
          Toast.show("请填写驳回原因");
          return;
        }
        setActing(true);
        try {
          await requisitionApi.audit(sel!.id, "reject", rejectRemarkRef.current.trim());
          Toast.show("已驳回，库存已回补");
          setSel(null);
          await load();
        } catch (e) {
          Toast.show(e instanceof Error ? e.message : "操作失败");
        } finally {
          setActing(false);
        }
      },
    });
  }

  if (sel) {
    return (
      <div style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
        <NavBar onBack={() => setSel(null)}>领用审计</NavBar>
        <div style={{ padding: 12 }}>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{sel.bill_no}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginTop: 10, fontSize: 12.5 }}>
              <div><div style={{ color: "#5B6478" }}>申请人</div><div style={{ marginTop: 2 }}>{sel.applicant_name}</div></div>
              <div><div style={{ color: "#5B6478" }}>仓库</div><div style={{ marginTop: 2 }}>{sel.warehouse_name}</div></div>
              <div style={{ gridColumn: "1/-1" }}><div style={{ color: "#5B6478" }}>使用地点</div><div style={{ marginTop: 2, fontWeight: 500 }}>{sel.use_location}</div></div>
              <div style={{ gridColumn: "1/-1" }}><div style={{ color: "#5B6478" }}>因何使用</div><div style={{ marginTop: 2, fontWeight: 500 }}>{sel.use_reason}</div></div>
              <div><div style={{ color: "#5B6478" }}>完成工作</div><div style={{ marginTop: 2 }}>{sel.work_done_at ? sel.work_done_at.slice(0, 16) : "—"}</div></div>
              <div><div style={{ color: "#5B6478" }}>总数量</div><div style={{ marginTop: 2 }}>{sel.total_qty}</div></div>
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ padding: "11px 14px", borderBottom: "1px solid #F2F5FB", fontSize: 13.5, fontWeight: 600 }}>
              领用明细（{sel.items.length} 项）
            </div>
            {sel.items.map((it) => (
              <div key={it.id} style={{ padding: "10px 14px", borderBottom: "1px solid #F2F5FB", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{it.product_name}</div>
                  <div style={{ fontSize: 11, color: "#5B6478", marginTop: 2 }}>{it.location_code}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{it.qty}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button block color="danger" fill="outline" loading={acting} style={{ height: 42, borderRadius: 9 }} onClick={doReject}>
              驳回
            </Button>
            <Button block color="primary" loading={acting} style={{ height: 42, borderRadius: 9 }} onClick={() => void doApprove()}>
              通过
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar onBack={() => navigate("/")}>领用审计</NavBar>
      <List style={{ "--border-top": "0" } as React.CSSProperties}>
        {list.map((b) => (
          <List.Item
            key={b.id}
            onClick={() => void openBill(b)}
            description={
              <div style={{ fontSize: 11.5, color: "#5B6478", marginTop: 3 }}>
                {b.applicant_name} · {b.warehouse_name} · {b.created_at.slice(0, 16)}
              </div>
            }
            extra={<Tag color="warning">待审计</Tag>}
          >
            <span style={{ fontSize: 14, fontWeight: 500 }}>{b.bill_no}</span>
            <span style={{ fontSize: 12, color: "#5B6478", marginLeft: 8 }}>共 {b.total_qty} 件</span>
          </List.Item>
        ))}
        {loading && <List.Item>加载中…</List.Item>}
        {!loading && list.length === 0 && <List.Item>暂无待审计领用单</List.Item>}
      </List>
    </div>
  );
}
