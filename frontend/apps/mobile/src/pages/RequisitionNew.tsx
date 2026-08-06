import { useEffect, useState } from "react";
import { Button, Input, List, NavBar, Popup, Stepper, Tag, Toast } from "antd-mobile";
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

/** 领用申请（使用者手机端核心页）：加商品 → 选库位 → 必填使用地点/原因 → 出库拍照（可选）→ 提交。
 *  《UI设计方案.md》§5.4：步骤条 + 卡片式明细 + 底部固定操作栏 + 草稿防丢。 */
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
  const [step, setStep] = useState(1); // 1 选商品 / 2 填信息 / 3 确认

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

  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  function validateRows(): string | null {
    if (!rows.length) return "请添加商品";
    for (const r of rows) {
      if (!r.location) return `请选择 ${r.product.name} 的库位`;
      if (!r.qty || Number(r.qty) <= 0) return `请填写 ${r.product.name} 的数量`;
    }
    return null;
  }

  async function submit() {
    if (!useLocation.trim()) return Toast.show("使用地点为必填项");
    if (!useReason.trim()) return Toast.show("因何使用为必填项");
    const err = validateRows();
    if (err) return Toast.show(err);
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

  function nextStep() {
    if (step === 1) {
      const err = validateRows();
      if (err) {
        Toast.show(err);
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!useLocation.trim()) {
        Toast.show("使用地点为必填项");
        return;
      }
      if (!useReason.trim()) {
        Toast.show("因何使用为必填项");
        return;
      }
      setStep(3);
    }
  }

  const StepBar = (
    <div style={{ display: "flex", gap: 0, background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 3, marginBottom: 12 }}>
      {["1 选商品", "2 填信息", "3 确认提交"].map((t, i) => (
        <div
          key={t}
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 12.5,
            fontWeight: 600,
            color: step === i + 1 ? "#fff" : "#86909c",
            background: step === i + 1 ? "#1668dc" : "transparent",
            borderRadius: 7,
            padding: "7px 0",
          }}
        >
          {t}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8", paddingBottom: 76 }}>
      <NavBar onBack={() => navigate("/")}>领用申请</NavBar>
      <div style={{ padding: 12 }}>
        {StepBar}

        {/* 步骤 1：商品明细 */}
        <div style={{ display: step === 1 ? "block" : "none" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "10px 2px 8px" }}>出库仓库</div>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: "4px 12px", marginBottom: 12 }}>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              style={{ width: "100%", height: 40, border: "none", background: "transparent", fontSize: 14 }}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "10px 2px 8px" }}>领用明细（{rows.length} 项）</div>
          {rows.map((r, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.product.name}</div>
                  <div style={{ fontSize: 11, color: "#86909c", marginTop: 1 }}>
                    {r.product.code}
                    {r.product.spec ? ` / ${r.product.spec}` : ""} / {r.product.unit_name}
                  </div>
                </div>
                <span style={{ color: "#ff4d4f", fontSize: 12, cursor: "pointer" }} onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                  删除
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <Tag color="primary" fill="outline" style={{ padding: "5px 10px", borderRadius: 7, marginRight: 0 }} onClick={() => void pickLocation(i)}>
                  {r.location ? r.location.code : "选库位"}
                </Tag>
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#86909c" }}>数量</span>
                  <Stepper min={1} value={Number(r.qty) || 1} onChange={(v) => updateRow(i, { qty: String(v) })} />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <PhotoUpload bizType="requisition_item" fileId={r.photoFileId} onChange={(fid) => updateRow(i, { photoFileId: fid })} />
              </div>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 40,
              border: "1px dashed #c9cdd4",
              borderRadius: 10,
              color: "#1668dc",
              fontSize: 13.5,
              cursor: "pointer",
              background: "#fafbfd",
              marginBottom: 8,
            }}
            onClick={() => setPickerOpen(true)}
          >
            ＋ 添加商品（扫码 / 搜索 / 拍照快查）
          </div>
          {step === 1 && (
            <Button block color="primary" style={{ height: 44, fontSize: 15, borderRadius: 10, marginTop: 4 }} onClick={nextStep}>
              下一步：填写使用信息
            </Button>
          )}
        </div>

        {/* 步骤 2：使用信息 + 拍照 */}
        <div style={{ display: step === 2 ? "block" : "none" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "10px 2px 8px" }}>使用信息（必填）</div>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              使用地点<span style={{ color: "#ff4d4f" }}>*</span>
            </div>
            <Input placeholder="如：维修部 · 3 号线" value={useLocation} onChange={setUseLocation} />
          </div>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              因何使用<span style={{ color: "#ff4d4f" }}>*</span>
            </div>
            <textarea
              placeholder="如：维修 XX 设备（电机型号 YE2-90L-4）"
              value={useReason}
              onChange={(e) => setUseReason(e.target.value)}
              style={{
                width: "100%",
                minHeight: 70,
                border: "none",
                outline: "none",
                fontSize: 14,
                fontFamily: "inherit",
                resize: "none",
                background: "transparent",
              }}
            />
          </div>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              备注 <span style={{ color: "#c9cdd4", fontSize: 11 }}>（可选）</span>
            </div>
            <Input placeholder="选填" value={remark} onChange={setRemark} />
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "14px 2px 8px" }}>出库拍照留痕（选填）</div>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#86909c", marginBottom: 10 }}>拍商品本身，照片随申请提交供仓管员审计核对（不强制）。</div>
            <PhotoUpload bizType="requisition_item" fileId={rows[0]?.photoFileId} onChange={(fid) => rows[0] && updateRow(0, { photoFileId: fid })} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button block fill="outline" style={{ height: 44, borderRadius: 10, flex: 1 }} onClick={() => setStep(1)}>
              上一步
            </Button>
            <Button block color="primary" style={{ height: 44, fontSize: 15, borderRadius: 10, flex: 2 }} onClick={nextStep}>
              下一步：确认提交
            </Button>
          </div>
        </div>

        {/* 步骤 3：确认 */}
        <div style={{ display: step === 3 ? "block" : "none" }}>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px", fontSize: 12.5 }}>
              <div><div style={{ color: "#86909c" }}>出库仓库</div><div style={{ marginTop: 2 }}>{warehouses.find((w) => w.id === warehouseId)?.name}</div></div>
              <div><div style={{ color: "#86909c" }}>总数量</div><div style={{ marginTop: 2 }}>{totalQty} 件</div></div>
              <div style={{ gridColumn: "1/-1" }}><div style={{ color: "#86909c" }}>使用地点</div><div style={{ marginTop: 2 }}>{useLocation}</div></div>
              <div style={{ gridColumn: "1/-1" }}><div style={{ color: "#86909c" }}>因何使用</div><div style={{ marginTop: 2 }}>{useReason}</div></div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button block fill="outline" style={{ height: 44, borderRadius: 10, flex: 1 }} onClick={() => setStep(2)}>
              上一步
            </Button>
            <Button block color="primary" loading={submitting} style={{ height: 44, fontSize: 15, borderRadius: 10, flex: 2 }} onClick={() => void submit()}>
              提交申请
            </Button>
          </div>
        </div>
      </div>

      {/* 底部固定操作栏（步骤 1/2 显示合计 + 下一步） */}
      {(step === 1 || step === 2) && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            background: "#fff",
            borderTop: "1px solid #f0f1f3",
            padding: "10px 12px",
            display: "flex",
            gap: 10,
            zIndex: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", fontSize: 13, color: "#86909c", paddingLeft: 4, minWidth: 90 }}>
            共 <b style={{ color: "#1f2329", fontSize: 15 }}>{totalQty}</b> 件
          </div>
          <Button block color="primary" style={{ height: 44, fontSize: 15, borderRadius: 10, flex: 1 }} onClick={nextStep}>
            {step === 1 ? "下一步" : "确认提交"}
          </Button>
        </div>
      )}

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
