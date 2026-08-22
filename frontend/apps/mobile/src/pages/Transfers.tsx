import { useEffect, useState } from "react";
import { Button, Dialog, List, NavBar, Popup, Stepper, Tabs, Tag, Toast } from "antd-mobile";
import { useNavigate } from "react-router";

import { ProductPicker, baseApi, transferApi, type Location, type Product, type TransferBill, type TransferDetail, type Warehouse } from "@wlt/shared";

const T_STATUS: Record<number, { text: string; color: "warning" | "success" | "danger" | "default" }> = {
  0: { text: "待审核", color: "warning" },
  1: { text: "已审核", color: "success" },
  [-1]: { text: "已作废", color: "default" },
  [-2]: { text: "已驳回", color: "danger" },
};

interface TransferRow {
  product?: Product;
  qty: string;
  fromLoc?: Location;
  toLoc?: Location;
}

/** 库存调拨（手机端）：调拨单列表 + 新建（草稿）+ 详情审核/驳回/作废（与桌面端同一接口）。 */
export function TransfersPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [list, setList] = useState<TransferBill[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<TransferDetail | null>(null);
  const [acting, setActing] = useState(false);

  // 新建表单
  const [createOpen, setCreateOpen] = useState(false);
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [fromWh, setFromWh] = useState<number>(0);
  const [toWh, setToWh] = useState<number>(0);
  const [fromLocs, setFromLocs] = useState<Location[]>([]);
  const [toLocs, setToLocs] = useState<Location[]>([]);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locPicker, setLocPicker] = useState<{ kind: "from" | "to"; rowIndex: number; open: boolean }>({ kind: "from", rowIndex: -1, open: false });

  async function load(status?: number) {
    setLoading(true);
    try {
      const d = await transferApi.list(status, 1, 50);
      setList(d.list);
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(tab === "all" ? undefined : Number(tab));
  }, [tab]);

  useEffect(() => {
    baseApi.warehouses().then((ws) => {
      const enabled = ws.filter((w) => w.status === 1);
      setWhs(enabled);
      if (enabled[0]) setFromWh(enabled[0].id);
      if (enabled[1]) setToWh(enabled[1].id);
    });
  }, []);

  async function onFromWh(id: number) {
    setFromWh(id);
    try {
      setFromLocs(await baseApi.locations(id));
    } catch {
      setFromLocs([]);
    }
  }

  async function onToWh(id: number) {
    setToWh(id);
    try {
      setToLocs(await baseApi.locations(id));
    } catch {
      setToLocs([]);
    }
  }

  function openLocPicker(kind: "from" | "to", rowIndex: number) {
    const locs = kind === "from" ? fromLocs : toLocs;
    if (!locs.length) return Toast.show("该仓库暂无库位");
    setLocPicker({ kind, rowIndex, open: true });
  }

  function updateRow(i: number, patch: Partial<TransferRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    if (!fromWh || !toWh) return Toast.show("请选择调出/调入仓库");
    if (fromWh === toWh) return Toast.show("调出与调入不能是同一仓库");
    if (!rows.length) return Toast.show("请添加调拨明细");
    for (const r of rows) {
      if (!r.product) return Toast.show("请选择材料");
      if (!r.fromLoc) return Toast.show(`请选择 ${r.product.name} 的调出库位`);
      if (!r.toLoc) return Toast.show(`请选择 ${r.product.name} 的调入库位`);
      if (!Number(r.qty) || Number(r.qty) <= 0) return Toast.show(`请填写 ${r.product.name} 的数量`);
    }
    setSubmitting(true);
    try {
      const data = await transferApi.create(
        fromWh,
        toWh,
        rows.map((r) => ({ product_id: r.product!.id, qty: r.qty, from_location_id: r.fromLoc!.id, to_location_id: r.toLoc!.id })),
        remark.trim()
      );
      Toast.show(`已创建调拨单 ${data.bill_no}，等待审核`);
      setCreateOpen(false);
      setRows([]);
      setRemark("");
      await load(tab === "all" ? undefined : Number(tab));
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function openBill(b: TransferBill) {
    try {
      setSel(await transferApi.detail(b.id));
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "加载失败");
    }
  }

  async function doAudit() {
    if (!sel || acting) return;
    setActing(true);
    try {
      await transferApi.audit(sel.id);
      Toast.show("已审核（库存已调拨）");
      setSel(null);
      await load(tab === "all" ? undefined : Number(tab));
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    } finally {
      setActing(false);
    }
  }

  async function doReject() {
    if (!sel || acting) return;
    const ok = await Dialog.confirm({ content: "确认驳回该调拨单？驳回后不产生库存变动。" });
    if (!ok) return;
    setActing(true);
    try {
      await transferApi.reject(sel.id);
      Toast.show("已驳回");
      setSel(null);
      await load(tab === "all" ? undefined : Number(tab));
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    } finally {
      setActing(false);
    }
  }

  async function doVoid() {
    if (!sel || acting) return;
    const ok = await Dialog.confirm({ content: "确认作废该调拨单？" });
    if (!ok) return;
    setActing(true);
    try {
      await transferApi.void(sel.id);
      Toast.show("已作废");
      setSel(null);
      await load(tab === "all" ? undefined : Number(tab));
    } catch (e) {
      Toast.show(e instanceof Error ? e.message : "操作失败");
    } finally {
      setActing(false);
    }
  }

  // ===== 详情视图 =====
  if (sel) {
    const st = T_STATUS[sel.status] ?? { text: String(sel.status), color: "default" as const };
    return (
      <div style={{ minHeight: "100dvh", background: "#f5f6f8" }}>
        <NavBar onBack={() => setSel(null)}>调拨详情</NavBar>
        <div style={{ padding: 12 }}>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{sel.bill_no}</span>
              <Tag color={st.color}>{st.text}</Tag>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginTop: 10, fontSize: 12.5 }}>
              <div><div style={{ color: "#646a73" }}>调出仓库</div><div style={{ marginTop: 2 }}>{sel.from_warehouse_name}</div></div>
              <div><div style={{ color: "#646a73" }}>调入仓库</div><div style={{ marginTop: 2 }}>{sel.to_warehouse_name}</div></div>
              <div><div style={{ color: "#646a73" }}>创建时间</div><div style={{ marginTop: 2 }}>{sel.created_at.slice(0, 16)}</div></div>
              <div><div style={{ color: "#646a73" }}>审核人</div><div style={{ marginTop: 2 }}>{sel.audit_name || "—"}</div></div>
            </div>
            {sel.remark && <div style={{ fontSize: 12, color: "#646a73", marginTop: 10 }}>备注：{sel.remark}</div>}
          </div>
          <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ padding: "11px 14px", borderBottom: "1px solid #f5f6f8", fontSize: 13.5, fontWeight: 600 }}>
              调拨明细（{sel.items.length} 项）
            </div>
            {sel.items.map((it) => (
              <div key={it.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f5f6f8" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13.5 }}>
                  <span style={{ fontWeight: 500 }}>{it.product_name}</span>
                  <span style={{ fontWeight: 600 }}>{it.qty}</span>
                </div>
                <div style={{ fontSize: 11, color: "#646a73", marginTop: 3 }}>
                  {it.from_location_code} → {it.to_location_code}
                </div>
              </div>
            ))}
          </div>
          {(sel.status === 0 || sel.status === -2) && (
            <div style={{ display: "flex", gap: 10 }}>
              {sel.status === -2 && (
                <Button block fill="outline" color="danger" loading={acting} style={{ height: 42, borderRadius: 9 }} onClick={() => void doVoid()}>
                  作废
                </Button>
              )}
              {sel.status === 0 && (
                <>
                  <Button block fill="outline" color="danger" loading={acting} style={{ height: 42, borderRadius: 9 }} onClick={() => void doReject()}>
                    驳回
                  </Button>
                  <Button block color="primary" loading={acting} style={{ height: 42, borderRadius: 9 }} onClick={() => void doAudit()}>
                    审核通过
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== 列表视图 =====
  return (
    <div style={{ minHeight: "100dvh", background: "#f5f6f8", paddingBottom: 72 }}>
      <NavBar onBack={() => navigate("/")}>库存调拨</NavBar>
      <Tabs activeKey={tab} onChange={setTab}>
        <Tabs.Tab title="全部" key="all" />
        <Tabs.Tab title="待审核" key="0" />
        <Tabs.Tab title="已审核" key="1" />
        <Tabs.Tab title="已驳回" key="-2" />
      </Tabs>
      <List style={{ "--border-top": "0" } as React.CSSProperties}>
        {list.map((b) => {
          const st = T_STATUS[b.status] ?? { text: String(b.status), color: "default" as const };
          return (
            <List.Item
              key={b.id}
              onClick={() => void openBill(b)}
              description={
                <div style={{ fontSize: 11.5, color: "#646a73", marginTop: 3 }}>
                  {b.from_warehouse_name} → {b.to_warehouse_name} · {b.created_at.slice(0, 16)}
                </div>
              }
              extra={<Tag color={st.color}>{st.text}</Tag>}
            >
              <span style={{ fontSize: 14, fontWeight: 500 }}>{b.bill_no}</span>
            </List.Item>
          );
        })}
        {loading && <List.Item>加载中…</List.Item>}
        {!loading && list.length === 0 && <List.Item>暂无调拨单</List.Item>}
      </List>

      {/* 底部固定按钮：新建调拨（宽屏居中限宽） */}
      <div
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: 0,
          width: "100%",
          maxWidth: 720,
          boxSizing: "border-box",
          padding: "10px 12px",
          paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
          background: "#fff",
          borderTop: "1px solid #f0f1f3",
          zIndex: 20,
        }}
      >
        <Button block color="primary" style={{ height: 44, fontSize: 15, borderRadius: 10 }} onClick={() => setCreateOpen(true)}>
          ＋ 新建调拨
        </Button>
      </div>

      {/* 新建调拨：全屏表单 */}
      <Popup visible={createOpen} onMaskClick={() => setCreateOpen(false)} bodyStyle={{ height: "100dvh", background: "#f5f6f8" }} destroyOnClose>
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <NavBar onBack={() => setCreateOpen(false)}>新建调拨</NavBar>
          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "6px 2px 8px" }}>调出 / 调入仓库</div>
            <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: "4px 12px", marginBottom: 12 }}>
              <select value={fromWh} onChange={(e) => void onFromWh(Number(e.target.value))} style={{ width: "100%", height: 40, border: "none", background: "transparent", fontSize: 14 }}>
                {whs.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: "4px 12px", marginBottom: 12 }}>
              <select value={toWh} onChange={(e) => void onToWh(Number(e.target.value))} style={{ width: "100%", height: 40, border: "none", background: "transparent", fontSize: 14 }}>
                {whs.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4e5969", margin: "6px 2px 8px" }}>调拨明细（{rows.length} 项）</div>
            {rows.map((r, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {r.product ? (
                      <>
                        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.product.name}</div>
                        <div style={{ fontSize: 11, color: "#646a73", marginTop: 1 }}>{r.product.code}</div>
                      </>
                    ) : (
                      <span style={{ color: "#1668dc", fontSize: 13 }} onClick={() => setPickerOpen(true)}>选择材料</span>
                    )}
                  </div>
                  <span style={{ color: "#ff4d4f", fontSize: 12, cursor: "pointer" }} onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                    删除
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <Tag color="primary" fill="outline" style={{ padding: "5px 10px", borderRadius: 7, marginRight: 0 }} onClick={() => openLocPicker("from", i)}>
                    {r.fromLoc ? r.fromLoc.display ?? r.fromLoc.code : "调出库位"}
                  </Tag>
                  <span style={{ color: "#c9cdd4" }}>→</span>
                  <Tag color="success" fill="outline" style={{ padding: "5px 10px", borderRadius: 7, marginRight: 0 }} onClick={() => openLocPicker("to", i)}>
                    {r.toLoc ? r.toLoc.display ?? r.toLoc.code : "调入库位"}
                  </Tag>
                  <div style={{ flex: 1 }} />
                  <Stepper min={1} value={Number(r.qty) || 1} onChange={(v) => updateRow(i, { qty: String(v) })} />
                </div>
              </div>
            ))}
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 40,
                border: "1px dashed #c9cdd4", borderRadius: 10, color: "#1668dc", fontSize: 13.5, cursor: "pointer",
                background: "#fafbfd", marginBottom: 12,
              }}
              onClick={() => setPickerOpen(true)}
            >
              + 添加材料
            </div>
            <div style={{ background: "#fff", border: "1px solid #f0f1f3", borderRadius: 10, padding: "4px 12px", marginBottom: 12 }}>
              <input placeholder="备注（选填）" value={remark} onChange={(e) => setRemark(e.target.value)} style={{ width: "100%", height: 40, border: "none", background: "transparent", fontSize: 14 }} />
            </div>
          </div>
          <div style={{ padding: 12, background: "#fff", borderTop: "1px solid #f0f1f3" }}>
            <Button block color="primary" loading={submitting} style={{ height: 44, fontSize: 15, borderRadius: 10 }} onClick={() => void submit()}>
              提交调拨（待审核）
            </Button>
          </div>
        </div>
      </Popup>

      <ProductPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(p) => {
          if (rows.some((r) => r.product?.id === p.id)) return Toast.show("材料已在明细中");
          setRows((rs) => [...rs, { product: p, qty: "1" }]);
          setPickerOpen(false);
        }}
      />

      <Popup visible={locPicker.open} onMaskClick={() => setLocPicker((s) => ({ ...s, open: false }))} bodyStyle={{ height: "50vh" }}>
        <List header={locPicker.kind === "from" ? "选择调出库位" : "选择调入库位"}>
          {(locPicker.kind === "from" ? fromLocs : toLocs).map((l) => (
            <List.Item
              key={l.id}
              onClick={() => {
                updateRow(locPicker.rowIndex, locPicker.kind === "from" ? { fromLoc: l } : { toLoc: l });
                setLocPicker((s) => ({ ...s, open: false }));
              }}
            >
              {l.display ?? l.code}
            </List.Item>
          ))}
        </List>
      </Popup>
    </div>
  );
}
