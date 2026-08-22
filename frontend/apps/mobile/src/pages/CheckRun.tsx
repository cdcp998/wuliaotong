import { useEffect, useState } from "react";
import { Button, Input, List, NavBar, Tag, Toast } from "antd-mobile";
import { useNavigate, useParams } from "react-router";

import { PhotoUpload, PlusIcon, ProductPicker, checkApi, type CheckBill, type CheckItem, type Product } from "@wlt/shared";

interface ExtraRow {
  key: number;
  product: Product;
  real: string;
}

/** 盘点执行（标准流程）：逐项显示账面 → 输入实盘 → 拍照记录（可选）→ 当场新增账外物料 → 提交 → 电脑端审核。 */
export function CheckRunPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bill, setBill] = useState<CheckBill | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { real: string; photo?: number }>>({});
  const [extraRows, setExtraRows] = useState<ExtraRow[]>([]); // 当场新增的账外物料（账面 0）
  const [pickerOpen, setPickerOpen] = useState(false);
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

  if (!bill) return <NavBar onBack={() => navigate("/checks")}>盘点执行</NavBar>;

  const readonly = bill.status === 2; // 已审核只读

  async function submit() {
    if (!bill) return;
    for (const r of extraRows) {
      if (!r.real || Number(r.real) <= 0) return Toast.show(`请填写新增物料 ${r.product.name} 的实盘数量`);
    }
    const items = [
      ...Object.entries(drafts).map(([itemId, d]) => ({
        check_item_id: Number(itemId),
        real_qty: d.real || "0",
        photo_file_id: d.photo ?? 0,
      })),
      ...extraRows.map((r) => ({
        check_item_id: 0, // 0 = 当场新增账外物料
        product_id: r.product.id,
        real_qty: r.real,
      })),
    ];
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
    <div className="wlt-page-enter" style={{ minHeight: "100dvh", background: "#F2F5FB" }}>
      <NavBar onBack={() => navigate("/checks")}>{bill.bill_no}</NavBar>
      <List header={`${bill.warehouse_name} · 共 ${bill.items.length} 项（物品级盘点）`}>
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
                  <span style={{ color: "#5B6478", fontSize: 12 }}>
                    {it.material_code || it.code}
                    {it.spec && ` / ${it.spec}`}
                    {it.unit_name && ` / ${it.unit_name}`}
                    {it.real_qty != null && <span style={{ marginLeft: 8 }}>已录：{it.real_qty}</span>}
                  </span>
                </div>
              }
            >
              {it.product_name}
            </List.Item>
          );
        })}
        {!readonly && bill.items.length > 0 && (
          <List.Item>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                height: 40,
                border: "1px dashed #c9cdd4",
                borderRadius: 10,
                color: "#5B7FFF",
                fontSize: 13.5,
                cursor: "pointer",
                background: "#fafbfd",
              }}
              onClick={() => setPickerOpen(true)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <PlusIcon size={15} /> 当场新增账外物料（盘点发现但账面没有的实物）
              </span>
            </div>
          </List.Item>
        )}
        {!readonly && extraRows.map((r) => (
          <List.Item
            key={r.key}
            description={
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Tag color="danger" fill="outline">账外新增（账面 0）</Tag>
                  <Input
                    placeholder="实盘数量"
                    type="number"
                    value={r.real}
                    onChange={(v) => setExtraRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, real: v } : x)))}
                    style={{ flex: 1, border: "1px solid #eee", borderRadius: 6, padding: "4px 8px" }}
                  />
                  <span style={{ color: "#EF4444", fontSize: 12, cursor: "pointer" }} onClick={() => setExtraRows((rs) => rs.filter((x) => x.key !== r.key))}>删</span>
                </div>
                <span style={{ color: "#5B6478", fontSize: 12 }}>
                  {r.product.code}
                  {r.product.spec ? ` / ${r.product.spec}` : ""} / {r.product.unit_name}
                </span>
              </div>
            }
          >
            {r.product.name}
          </List.Item>
        ))}
      </List>

      {!readonly && (
        <div style={{ padding: 16 }}>
          <Button block color="primary" loading={saving} onClick={() => void submit()}>
            提交盘点结果
          </Button>
        </div>
      )}
      {readonly && (
        <div style={{ padding: 16, textAlign: "center", color: "#5B6478" }}>该盘点单已审核（只读）</div>
      )}

      <ProductPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(p) => {
          if (bill?.items.some((it) => it.product_id === p.id) || extraRows.some((r) => r.product.id === p.id)) {
            return Toast.show("该物料已在盘点单中");
          }
          setExtraRows((rs) => [...rs, { key: Date.now() + rs.length, product: p, real: "" }]);
        }}
      />
    </div>
  );
}
