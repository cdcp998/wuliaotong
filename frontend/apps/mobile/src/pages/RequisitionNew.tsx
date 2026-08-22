import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Input, List, NavBar, Popup, Stepper, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { PhotoUpload, PlusIcon, ProductPicker, useBackToClose, baseApi, requisitionApi, type Location, type Product, type Warehouse } from "@wlt/shared";

interface Row {
  product: Product;
  location?: Location;
  qty: string;
  photoFileId?: number;
}

/** 领用申请（使用者手机端核心页，单页统一提交）：出库仓库 + 领用明细 + 使用信息 + 出库拍照 → 一键提交。
 *  提交后自动出库；随后在申请详情中「完成工作拍照留痕」进入审计（领用申请 → 完成工作 → 仓管员审计 → 完成）。
 *  私用触发：在「因何使用」上连续点击 15 次（间隔 ≤1.5s）→ 锁定为「私用」（仅管理员可见真实状态）。 */
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
  const [isPrivate, setIsPrivate] = useState(false); // 私用标记（隐藏触发，仅管理员可见）
  const tapCountRef = useRef(0); // 「因何使用」连续点击计数
  const lastTapRef = useRef(0);

  // 返回键（硬件/浏览器）关闭「选择库位」弹层
  useBackToClose(locPicker.open, () => setLocPicker((s) => ({ ...s, open: false })));

  // 隐藏触发：在「因何使用」字段上连续点击 15 次（间隔 ≤1.5s）→ 确认后锁定为「私用」
  function onReasonTap() {
    if (isPrivate) return;
    const now = Date.now();
    if (now - lastTapRef.current > 1500) tapCountRef.current = 0;
    lastTapRef.current = now;
    tapCountRef.current += 1;
    if (tapCountRef.current >= 15) {
      tapCountRef.current = 0;
      Dialog.confirm({
        title: "标记为私用？",
        content: "「因何使用」将锁定为「私用」且不可再编辑；对外仅显示固定话术，真实状态仅管理员可见。",
        confirmText: "确认私用",
        cancelText: "取消",
        onConfirm: () => {
          setIsPrivate(true);
          setUseReason("私用");
        },
      });
    }
  }

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
    if (!rows.length) return "请添加材料";
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
      const data = await requisitionApi.create(warehouseId, useLocation.trim(), useReason.trim(), items, remark, isPrivate ? 1 : 0);
      Toast.show(`申请已提交：${data.bill_no}，请在工作完成后拍照留痕`);
      navigate(`/requisitions/${data.id}`, { replace: true });
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#F2F5FB", paddingBottom: "calc(84px + env(safe-area-inset-bottom))" }}>
      <NavBar onBack={() => navigate("/")}>领用申请</NavBar>
      <div style={{ padding: 12 }}>
        {/* 出库仓库 */}
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

        {/* 领用明细 */}
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "10px 2px 8px" }}>领用明细（{rows.length} 项）</div>
        {rows.map((r, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.product.name}</div>
                <div style={{ fontSize: 11, color: "#5B6478", marginTop: 1 }}>
                  {r.product.code}
                  {r.product.spec ? ` / ${r.product.spec}` : ""} / {r.product.unit_name}
                </div>
              </div>
              <span style={{ color: "#EF4444", fontSize: 12, cursor: "pointer" }} onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                删除
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <Tag color="primary" fill="outline" style={{ padding: "5px 10px", borderRadius: 7, marginRight: 0 }} onClick={() => void pickLocation(i)}>
                {r.location ? r.location.display ?? r.location.code : "选库位"}
              </Tag>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#5B6478" }}>数量</span>
                <Stepper min={1} value={Number(r.qty) || 1} onChange={(v) => updateRow(i, { qty: String(v) })} />
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <PhotoUpload translucent bizType="requisition_item" fileId={r.photoFileId} onChange={(fid) => updateRow(i, { photoFileId: fid })} />
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
            color: "#5B7FFF",
            fontSize: 13.5,
            cursor: "pointer",
            background: "#fafbfd",
            marginBottom: 12,
          }}
          onClick={() => setPickerOpen(true)}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <PlusIcon size={15} /> 添加材料（扫码 / 搜索 / 拍照快查）
          </span>
        </div>

        {/* 使用信息 */}
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "10px 2px 8px" }}>使用信息（必填）</div>
        <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            使用地点<span style={{ color: "#EF4444" }}>*</span>
          </div>
          <Input placeholder="如：维修部 · 3 号线" value={useLocation} onChange={setUseLocation} />
        </div>
        <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            因何使用<span style={{ color: "#EF4444" }}>*</span>
            {isPrivate && <Tag color="danger" fill="outline" style={{ marginLeft: 8, fontSize: 10 }}>私用</Tag>}
          </div>
          <textarea
            placeholder="如：维修 XX 设备（电机型号 YE2-90L-4）"
            value={isPrivate ? "私用" : useReason}
            disabled={isPrivate}
            onClick={onReasonTap}
            onChange={(e) => setUseReason(e.target.value)}
            style={{
              width: "100%",
              minHeight: 70,
              border: "none",
              outline: "none",
              fontSize: 14,
              fontFamily: "inherit",
              resize: "none",
              background: isPrivate ? "#fafbfd" : "transparent",
              color: isPrivate ? "#5B6478" : "inherit",
            }}
          />
          {isPrivate && (
            <div style={{ fontSize: 11, color: "#5B6478", marginTop: 4 }}>
              已锁定为私用：对外显示为固定话术，真实状态仅管理员可见。
            </div>
          )}
        </div>
        <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            备注 <span style={{ color: "#c9cdd4", fontSize: 11 }}>（可选）</span>
          </div>
          <Input placeholder="选填" value={remark} onChange={setRemark} />
        </div>

        {/* 出库拍照留痕 */}
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "14px 2px 8px" }}>出库拍照留痕（选填）</div>
        <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#5B6478", marginBottom: 10 }}>拍材料本身，照片随申请提交供仓管员审计核对（不强制）。</div>
          <PhotoUpload translucent bizType="requisition_item" fileId={rows[0]?.photoFileId} onChange={(fid) => rows[0] && updateRow(0, { photoFileId: fid })} />
        </div>
      </div>

      {/* 底部固定提交栏（居中 + 限宽，宽屏「应用窗口化」时不横跨整个视口；boxSizing 保证限宽含内边距） */}
      <div
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: 0,
          width: "100%",
          maxWidth: 720,
          background: "#fff",
          borderTop: "1px solid #f0f1f3",
          padding: "10px 12px",
          paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
          display: "flex",
          alignItems: "center",
          gap: 10,
          boxSizing: "border-box",
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 13, color: "#5B6478", paddingLeft: 4, whiteSpace: "nowrap", flexShrink: 0 }}>
          共 <b style={{ color: "#1E2433", fontSize: 15, margin: "0 2px" }}>{totalQty}</b> 件
        </div>
        <Button block color="primary" loading={submitting} style={{ height: 44, fontSize: 15, borderRadius: 10, flex: 1, minWidth: 0 }} onClick={() => void submit()}>
          提交申请
        </Button>
      </div>

      <ProductPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(p) => {
          if (rows.some((r) => r.product.id === p.id)) return Toast.show("材料已在明细中");
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
              {l.display ?? l.code}
            </List.Item>
          ))}
          {!locPicker.locations.length && <List.Item>该仓库暂无库位</List.Item>}
        </List>
      </Popup>
    </div>
  );
}
