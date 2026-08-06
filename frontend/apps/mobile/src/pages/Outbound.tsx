import { useEffect, useState } from "react";
import { Button, Input, List, NavBar, Popup, Selector, Tag, Toast } from "antd-mobile";
import { useNavigate, useSearchParams } from "react-router-dom";

import { baseApi, otherIo, type Location, type Product, type Warehouse } from "@wlt/shared";

import { PhotoUpload } from "../components/PhotoUpload";
import { ProductPicker } from "../components/ProductPicker";

const IO_TYPES = ["报废", "报损", "赠品出", "其他出"];

interface Row {
  product: Product;
  location?: Location;
  qty: string;
  photoFileId?: number;
}

export function OutboundPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [ioType, setIoType] = useState(IO_TYPES[0]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<number>(0);
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
    // 拍照快查带入：?product_id=xxx 自动加入明细行
    const pid = Number(params.get("product_id"));
    if (pid) {
      baseApi
        .product(pid)
        .then((p) => setRows((rs) => (rs.some((r) => r.product.id === p.id) ? rs : [...rs, { product: p, qty: "1" }])))
        .catch(() => Toast.show("商品不存在"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickLocation(rowIndex: number) {
    const locs = await baseApi.locations(warehouseId);
    setLocPicker({ rowIndex, locations: locs, open: true });
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
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
      const data = await otherIo(ioType, warehouseId, items);
      Toast.show(`${ioType}成功：${data.bill_no}`);
      navigate("/", { replace: true });
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <NavBar onBack={() => navigate("/")}>其他出库</NavBar>
      <List header="出库类型">
        <List.Item>
          <Selector options={IO_TYPES.map((t) => ({ label: t, value: t }))} value={[ioType]} onChange={(v) => v[0] && setIoType(v[0])} />
        </List.Item>
      </List>
      <List header="仓库">
        <List.Item
          extra={
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              style={{ border: "none", background: "transparent", fontSize: 15 }}
            >
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
                  <Input
                    placeholder="数量"
                    type="number"
                    value={r.qty}
                    onChange={(v) => updateRow(i, { qty: v })}
                    style={{ flex: 1, border: "1px solid #eee", borderRadius: 6, padding: "4px 8px" }}
                  />
                  <PhotoUpload
                    bizType="requisition_item"
                    fileId={r.photoFileId}
                    onChange={(fid) => updateRow(i, { photoFileId: fid })}
                  />
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

      <div style={{ padding: 16 }}>
        <Button block color="danger" loading={submitting} onClick={() => void submit()}>
          提交{ioType}
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

      <Popup
        visible={locPicker.open}
        onMaskClick={() => setLocPicker((s) => ({ ...s, open: false }))}
        bodyStyle={{ height: "50vh" }}
      >
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
