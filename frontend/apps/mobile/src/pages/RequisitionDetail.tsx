import { useEffect, useState } from "react";
import { Button, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate, useParams } from "react-router-dom";

import { requisitionApi, type RequisitionDetail } from "@wlt/shared";

const STATUS: Record<number, { text: string; color: string }> = {
  1: { text: "待审计", color: "warning" },
  2: { text: "已通过", color: "success" },
  3: { text: "已驳回", color: "danger" },
  4: { text: "已取消", color: "default" },
};

/** 申请详情（手机端）：明细 + 照片 + 审计结果与备注（《UI设计方案.md》§5.4）。 */
export function RequisitionDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);

  useEffect(() => {
    requisitionApi
      .detail(Number(id))
      .then(setDetail)
      .catch((e) => Toast.show(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  if (!detail) return <div style={{ minHeight: "100vh", background: "#f5f6f8", textAlign: "center", paddingTop: 80, color: "#86909c" }}>加载中…</div>;

  const st = STATUS[detail.status];

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate(-1)}>申请详情</NavBar>
      <div style={{ padding: 12 }}>
        {/* 单头信息 */}
        <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{detail.bill_no}</span>
            <Tag color={st.color}>{st.text}</Tag>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px", marginTop: 12, fontSize: 12.5 }}>
            <div><div style={{ color: "#86909c" }}>申请人</div><div style={{ marginTop: 2 }}>{detail.applicant_name}</div></div>
            <div><div style={{ color: "#86909c" }}>仓库</div><div style={{ marginTop: 2 }}>{detail.warehouse_name}</div></div>
            <div style={{ gridColumn: "1/-1" }}><div style={{ color: "#86909c" }}>使用地点（必填）</div><div style={{ marginTop: 2, fontWeight: 500 }}>{detail.use_location}</div></div>
            <div style={{ gridColumn: "1/-1" }}><div style={{ color: "#86909c" }}>因何使用（必填）</div><div style={{ marginTop: 2, fontWeight: 500 }}>{detail.use_reason}</div></div>
            <div><div style={{ color: "#86909c" }}>申请时间</div><div style={{ marginTop: 2 }}>{detail.created_at.slice(0, 16)}</div></div>
            <div><div style={{ color: "#86909c" }}>总数量</div><div style={{ marginTop: 2 }}>{detail.total_qty}</div></div>
          </div>
        </div>

        {/* 明细 */}
        <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
          <div style={{ padding: "11px 14px", borderBottom: "1px solid #f5f6f8", fontSize: 13.5, fontWeight: 600 }}>
            领用明细（{detail.items.length} 项）
          </div>
          {detail.items.map((it) => (
            <div key={it.id} style={{ padding: "11px 14px", borderBottom: "1px solid #f5f6f8", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{it.product_name}</div>
                <div style={{ fontSize: 11.5, color: "#86909c", marginTop: 2 }}>
                  {it.location_code}
                  {it.spec ? ` · ${it.spec}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{it.qty}</div>
                <div style={{ fontSize: 10.5, color: "#c9cdd4", marginTop: 2 }}>{it.photo_file_id ? "已留痕" : "未拍照"}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 审计结果 */}
        {detail.status === 3 && detail.audit_remark && (
          <div style={{ background: "#fff1f0", border: "1px solid #ffccc7", color: "#cf1322", borderRadius: 12, padding: 12, fontSize: 13, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>驳回原因</div>
            {detail.audit_remark}
          </div>
        )}
        {detail.status === 2 && detail.audit_name && (
          <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", color: "#389e0d", borderRadius: 12, padding: 12, fontSize: 13, marginBottom: 10 }}>
            已由 {detail.audit_name} 于 {detail.audit_time?.slice(0, 16)} 审计通过，库存已扣减。
          </div>
        )}

        {/* 已驳回可修改重提 */}
        {detail.status === 3 && (
          <Button block color="primary" onClick={() => navigate("/requisitions/new")}>
            修改后重新提交
          </Button>
        )}
      </div>
    </div>
  );
}
