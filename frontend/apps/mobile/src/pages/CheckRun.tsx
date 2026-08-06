import { useEffect, useState } from "react";
import { Button, Input, List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate, useParams } from "react-router-dom";

import { checkApi, type CheckBill, type CheckItem } from "@wlt/shared";

import { PhotoUpload } from "../components/PhotoUpload";

/** 盘点执行（标准流程）：逐项显示账面 → 输入实盘 → 拍照记录（可选）→ 提交 → 电脑端审核。 */
export function CheckRunPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bill, setBill] = useState<CheckBill | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { real: string; photo?: number }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    checkApi
      .detail(Number(id))
      .then((b) => {
        setBill(b);
        const init: Record<number, { real: string; photo?: number }> = {};
        for (const it of b.items) {
          init[it.id] = { real: it.real_qty ?? "", photo: it.photo_file_id || undefined };
        }
        setDrafts(init);
      })
      .catch((e) => Toast.show(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  if (!bill) return <NavBar>盘点执行</NavBar>;

  const readonly = bill.status === 2; // 已审核只读

  async function submit() {
    if (!bill) return;
    const items = Object.entries(drafts).map(([itemId, d]) => ({
      check_item_id: Number(itemId),
      real_qty: d.real || "0",
      photo_file_id: d.photo ?? 0,
    }));
    setSaving(true);
    try {
      await checkApi.saveItems(bill.id, items);
      Toast.show("已保存，等待仓管审核");
      navigate("/checks", { replace: true });
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/checks")}>{bill.bill_no}</NavBar>
      <List header={`${bill.warehouse_name} · 共 ${bill.items.length} 项`}>
        {bill.items.map((it: CheckItem) => {
          const d = drafts[it.id] ?? { real: "" };
          return (
            <List.Item
              key={it.id}
              description={
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Tag color="primary" fill="outline">
                      账面 {it.book_qty}
                    </Tag>
                    <Input
                      placeholder="实盘数量"
                      type="number"
                      disabled={readonly}
                      value={d.real}
                      onChange={(v) => setDrafts((s) => ({ ...s, [it.id]: { ...s[it.id], real: v } }))}
                      style={{ flex: 1, border: "1px solid #eee", borderRadius: 6, padding: "4px 8px" }}
                    />
                    {!readonly && (
                      <PhotoUpload
                        bizType="check"
                        fileId={d.photo}
                        onChange={(fid) => setDrafts((s) => ({ ...s, [it.id]: { ...s[it.id], photo: fid } }))}
                      />
                    )}
                  </div>
                  <span style={{ color: "#999", fontSize: 12 }}>
                    {it.code} / {it.location_code}
                    {it.real_qty != null && <span style={{ marginLeft: 8 }}>已录：{it.real_qty}</span>}
                  </span>
                </div>
              }
            >
              {it.product_name}
            </List.Item>
          );
        })}
      </List>

      {!readonly && (
        <div style={{ padding: 16 }}>
          <Button block color="primary" loading={saving} onClick={() => void submit()}>
            提交盘点结果
          </Button>
        </div>
      )}
      {readonly && (
        <div style={{ padding: 16, textAlign: "center", color: "#999" }}>该盘点单已审核（只读）</div>
      )}
    </div>
  );
}
