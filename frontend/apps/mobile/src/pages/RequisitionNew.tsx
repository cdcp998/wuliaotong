import { useEffect, useState } from "react";
import { Button, Input, List, NavBar, Popup, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { baseApi, requisitionApi, type Location, type Product, type Warehouse } from "@wlt/shared";

import { PhotoUpload } from "../components/PhotoUpload";
import { ProductPicker } from "../components/ProductPicker";

interface Row {
  product: Product;
  location?: Location;
  qty: string;
  photoFileId?: number;
}

/** 领用申请（使用者手机端）：加商品 → 选库位 → 使用地点/因何使用（必填）→ 拍照（可选）→ 提交。 */
export function RequisitionNewPage() {
  const navigate = useNavigate();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<number>(0);
  const [useLocation, setUseLocation] = useState("");
  const [useReason, setUseReason] = useState("");
  const [remark, setRemark] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locPicker, setLocPicker] = useState<{ rowIndex: number; locations: Location[]; open: boolean }>({
    rowIndex: -1,
    locations: [],
    open: false,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    baseApi.warehouses().then((ws) => {
      const enabled = ws.filter((w) => w.status === 1);
      setWarehouses(enabled);
      if (enabled.length) setWarehouseId(enabled[0].id);
    });
  }, []);

  async function pickLocation(rowIndex: number) {
    const locs = await baseApi.locations(warehouseId);
    setLocPicker({ rowIndex, locations: locs, open: true });
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    if (!useLocation.trim()) return Toast.show("使用地点为必填项");
    if (!useReason.trim()) return Toast.show("因何使用为必填项");
    if (!rows.length) return Toast.show("请添加商品");
    for (const r of rows) {
      if (!r.location) return Toast.show(`请选择 ${r.product.name} 的库位`);
      if (!r.qty || Number(r.qty) <= 0) return Toast.show(`请填写 ${r.product.name} 的数量`);
    }
    setSubmitting(true);
    try {
      const items = rows.map((r) => ({
        product_id: r.product.id,
        qty: r.qty,
        location_id: r.location!.id,
        photo_file_id: r.photoFileId ?? 0,
      }));
      const data = await requisitionApi.create(warehouseId, useLocation.trim(), useReason.trim(), items, remark);
      Toast.show(`申请已提交：${data.bill_no}，等待仓管审计`);
      navigate("/requisitions/list", { replace: true });
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/")}>领用申请</NavBar>

      <List header="基本信息（必填）">
        <List.Item>
          <Input placeholder="使用地点（必填）" value={useLocation} onChange={setUseLocation} />
        </List.Item>
        <List.Item>
          <Input placeholder="因何使用（必填）" value={useReason} onChange={setUseReason} />
        </List.Item>
        <List.Item
          extra={
            <select value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))} style={{ border: "none", background: "transparent", fontSize: 15 }}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          }
        >
          出库仓库
        </List.Item>
      </List>

      <List header={`商品明细（${rows.length}）`}>
        {rows.map((r, i) => (
          <List.Item
            key={i}
            description={
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Tag color="primary" fill="outline" onClick={() => void pickLocation(i)}>
                    {r.location ? r.location.code : "选库位"}
                  </Tag>
                  <Input placeholder="数量" type="number" value={r.qty} onChange={(v) => updateRow(i, { qty: v })} style={{ flex: 1, border: "1px solid #eee", borderRadius: 6, padding: "4px 8px" }} />
                  <PhotoUpload bizType="requisition_item" fileId={r.photoFileId} onChange={(fid) => updateRow(i, { photoFileId: fid })} />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Tag color="danger" fill="outline" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                    删除
                  </Tag>
                  <span style={{ color: "#999", fontSize: 12 }}>
                    {r.product.code}
                    {r.product.spec ? ` / ${r.product.spec}` : ""} / {r.product.unit_name}
                  </span>
                </div>
              </div>
            }
          >
            {r.product.name}
          </List.Item>
        ))}
        <List.Item onClick={() => setPickerOpen(true)} arrow="horizontal">
          + 添加商品
        </List.Item>
      </List>

      <List header="备注">
        <List.Item>
          <Input placeholder="备注（可选）" value={remark} onChange={setRemark} />
        </List.Item>
      </List>

      <div style={{ padding: 16 }}>
        <Button block color="primary" loading={submitting} onClick={() => void submit()}>
          提交申请
        </Button>
      </div>

      <ProductPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(p) => {
          if (rows.some((r) => r.product.id === p.id)) return Toast.show("商品已在明细中");
          setRows((rs) => [...rs, { product: p, qty: "1" }]);
        }}
      />

      <Popup visible={locPicker.open} onMaskClick={() => setLocPicker((s) => ({ ...s, open: false }))} bodyStyle={{ height: "50vh" }}>
        <List header="选择库位">
          {locPicker.locations.map((l) => (
            <List.Item
              key={l.id}
              onClick={() => {
                updateRow(locPicker.rowIndex, { location: l });
                setLocPicker((s) => ({ ...s, open: false }));
              }}
            >
              {l.code}
            </List.Item>
          ))}
          {!locPicker.locations.length && <List.Item>该仓库暂无库位</List.Item>}
        </List>
      </Popup>
    </div>
  );
}
