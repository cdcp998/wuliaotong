import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Space, Spin, Tag } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";

import { baseApi, reportApi, type LocationStock, type Shelf, type Warehouse } from "@wlt/shared";

const ALERT_COLOR: Record<string, string> = {
  low: "#f5222d",
  high: "#F59E0B",
  normal: "#22C55E",
};
const ALERT_TEXT: Record<string, string> = {
  low: "低于下限",
  high: "高于上限",
  normal: "正常",
};

/** 库位格状态 → 2.5D 单元格颜色（空=灰 / 正常=绿 / 低=红 / 高=黄）。 */
function cellStyle(items: LocationStock["items"]): { bg: string; border: string } {
  if (!items.length) return { bg: "#f5f5f5", border: "#d9d9d9" };
  if (items.some((i) => i.alert === "low")) return { bg: "#fff1f0", border: ALERT_COLOR.low };
  if (items.some((i) => i.alert === "high")) return { bg: "#fffbe6", border: ALERT_COLOR.high };
  return { bg: "#f6ffed", border: ALERT_COLOR.normal };
}

/** 2.5D 货架视图（仓库与货架页内嵌，无独立页）：层×行×列 → 隔（3D 方块格子），格子内直接展示物料+数量。 */
function Shelf25D({ shelf, cells, onCell }: {
  shelf: Shelf;
  cells: Map<string, LocationStock>;
  onCell: (loc: LocationStock) => void;
}) {
  const layers = shelf.layers ?? 1;
  const rows = shelf.rows ?? 1;
  const cols = shelf.cols ?? 1;
  const layerKeys = Array.from({ length: layers }, (_, i) => layers - i); // 顶→底（顶层最亮）
  return (
    <>
      <div style={{ fontSize: 12, color: "#5B6478", marginBottom: 8 }}>
        {layers}层 × {rows}行 × {cols}列 · 格子内直接显示物料，点击格子查看完整明细
      </div>
      {/* 层从顶到底堆叠，每层一个托盘面板；格子为 3D 方块（loc-cell3d） */}
      {layerKeys.map((layer) => (
        <div key={layer} className="rack-layer">
          <div className="rack-layer-title">第 {layer} 层</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(96px, 1fr))`, gap: 12 }}>
            {Array.from({ length: rows }, (_, ri) => ri + 1).map((row) =>
              Array.from({ length: cols }, (_, ci) => ci + 1).map((col) => {
                const loc = cells.get(`${shelf.id}-${layer}-${row}-${col}`);
                const st = cellStyle(loc?.items ?? []);
                return (
                  <div
                    key={`${row}-${col}`}
                    className={loc ? "loc-cell3d" : "loc-cell3d loc-cell3d-empty"}
                    onClick={() => loc && onCell(loc)}
                    title={loc ? `${loc.location_code}（${loc.items.length ? `${loc.items.length} 种材料` : "空"}）` : "空位（未创建库位）"}
                    style={{ background: st.bg, borderColor: st.border }}
                  >
                    <div className="loc-cell3d-label">R{row}C{col}</div>
                    {loc && loc.items.length > 0 ? (
                      <>
                        {loc.items.slice(0, 2).map((it) => (
                          <div key={it.product_id} className="loc-cell3d-mat" title={`${it.name}${it.spec ? `（${it.spec}）` : ""}`}>
                            <span className="loc-cell3d-mat-name">{it.name}</span>
                            <span className="loc-cell3d-mat-qty">×{it.qty}</span>
                          </div>
                        ))}
                        {loc.items.length > 2 && <div className="loc-cell3d-more">+{loc.items.length - 2} 种…</div>}
                      </>
                    ) : (
                      <div className="loc-cell3d-empty-text">{loc ? "空" : "未建"}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/** 仓库与货架（电脑端，库存管理分组，base:warehouse）：左侧仓库列表（含汇总）→ 右侧 2.5D 货架视图（内嵌，无独立页）。 */
export function WarehousesPage() {
  const { message } = App.useApp();
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [whLoading, setWhLoading] = useState(false);
  const [selectedWh, setSelectedWh] = useState<Warehouse | null>(null);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [cellMap, setCellMap] = useState<Map<string, LocationStock>>(new Map());
  const [busy, setBusy] = useState(false);
  const [whModal, setWhModal] = useState<{ open: boolean; editing: Warehouse | null }>({ open: false, editing: null });
  const [shelfModal, setShelfModal] = useState<{ open: boolean; editing: Shelf | null }>({ open: false, editing: null });
  const [locModal, setLocModal] = useState<{ open: boolean; shelf: Shelf | null }>({ open: false, shelf: null });
  const [whForm] = Form.useForm();
  const [shelfForm] = Form.useForm();
  const [locForm] = Form.useForm();
  // 单元格明细
  const [detail, setDetail] = useState<LocationStock | null>(null);
  // 货架搜索（设计页 17 筛选条：搜索库位/材料）
  const [shelfKw, setShelfKw] = useState("");
  /** 按搜索词过滤货架（匹配货架编号/名称/库位码/材料名）。 */
  const visibleShelves = useMemo(() => {
    const kw = shelfKw.trim().toLowerCase();
    if (!kw) return shelves;
    return shelves.filter((s) => {
      if (`${s.code}${s.name ?? ""}`.toLowerCase().includes(kw)) return true;
      for (const v of cellMap.values()) {
        if (!String(v.layer_no)) continue;
        const key = `${s.id}-${v.layer_no}-${v.row_no}-${v.col_no}`;
        if (cellMap.get(key) !== v) continue;
        if (v.location_code.toLowerCase().includes(kw)) return true;
        if (v.items.some((it) => it.name.toLowerCase().includes(kw))) return true;
      }
      return false;
    });
  }, [shelves, shelfKw, cellMap]);

  const loadWhs = useCallback(async (keepSelectedId?: number) => {
    setWhLoading(true);
    try {
      const list = await baseApi.warehouses();
      setWhs(list);
      setSelectedWh((cur) => {
        const keep = list.find((w) => w.id === (keepSelectedId ?? cur?.id));
        return keep ?? list[0] ?? null;
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "仓库加载失败");
    } finally {
      setWhLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadWhs();
  }, [loadWhs]);

  useEffect(() => {
    if (!selectedWh) {
      setShelves([]);
      setCellMap(new Map());
      return;
    }
    let alive = true;
    Promise.all([
      baseApi.shelves(selectedWh.id),
      reportApi.locationSummary(selectedWh.id),
    ])
      .then(([shs, sum]) => {
        if (!alive) return;
        setShelves(shs);
        setCellMap(new Map(sum.map((s) => [`${s.shelf_id}-${s.layer_no}-${s.row_no}-${s.col_no}`, s])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [selectedWh]);

  // ---------- 仓库 ----------
  async function saveWarehouse() {
    const v = await whForm.validateFields();
    setBusy(true);
    try {
      if (whModal.editing) {
        await baseApi.updateWarehouse(whModal.editing.id, { name: v.name, address: v.address ?? "", remark: v.remark ?? "" });
        message.success("仓库已保存");
      } else {
        await baseApi.createWarehouse({ code: v.name.trim(), name: v.name, address: v.address ?? "", remark: v.remark ?? "" });
        message.success("仓库已创建");
      }
      setWhModal({ open: false, editing: null });
      await loadWhs(whModal.editing?.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  // ---------- 货架 ----------
  async function saveShelf() {
    if (!selectedWh) return;
    const v = await shelfForm.validateFields();
    setBusy(true);
    try {
      if (shelfModal.editing) {
        await baseApi.updateShelf(shelfModal.editing.id, { name: v.name ?? "", remark: v.remark ?? "" });
        message.success("货架已保存");
      } else {
        // 批量生成：按 层×行×列 一次性创建全部库位（隔）
        const s = await baseApi.createShelf({ warehouse_id: selectedWh.id, code: v.code, name: v.name ?? "", remark: v.remark ?? "", layers: v.layers ?? 1, rows: v.rows ?? 1, cols: v.cols ?? 1 });
        message.success(`货架已创建（${s.layers}层 × ${s.rows}行 × ${s.cols}列，共 ${(s.layers ?? 1) * (s.rows ?? 1) * (s.cols ?? 1)} 个库位）`);
      }
      setShelfModal({ open: false, editing: null });
      await refreshSelected();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  // ---------- 库位（单格） ----------
  async function saveLocation() {
    if (!selectedWh || !locModal.shelf) return;
    const v = await locForm.validateFields();
    setBusy(true);
    try {
      await baseApi.createLocation({ warehouse_id: selectedWh.id, shelf_id: locModal.shelf.id, layer_no: v.layer_no, row_no: v.row_no, col_no: v.col_no, remark: v.remark ?? "" });
      message.success("库位已创建");
      setLocModal({ open: false, shelf: null });
      await refreshSelected();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  /** 刷新选中仓库的货架 + 2.5D 数据。 */
  const refreshSelected = useCallback(async () => {
    if (!selectedWh) return;
    const [shs, sum] = await Promise.all([
      baseApi.shelves(selectedWh.id),
      reportApi.locationSummary(selectedWh.id),
    ]);
    setShelves(shs);
    setCellMap(new Map(sum.map((s) => [`${s.shelf_id}-${s.layer_no}-${s.row_no}-${s.col_no}`, s])));
  }, [selectedWh]);

  // 图例
  const legend = (
    <Space size={14} wrap style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
      <span><span style={{ display: "inline-block", width: 12, height: 12, background: "#f6ffed", border: `1px solid ${ALERT_COLOR.normal}`, borderRadius: 3, marginRight: 4 }} />正常</span>
      <span><span style={{ display: "inline-block", width: 12, height: 12, background: "#fff1f0", border: `1px solid ${ALERT_COLOR.low}`, borderRadius: 3, marginRight: 4 }} />低于下限</span>
      <span><span style={{ display: "inline-block", width: 12, height: 12, background: "#fffbe6", border: `1px solid ${ALERT_COLOR.high}`, borderRadius: 3, marginRight: 4 }} />高于上限</span>
      <span><span style={{ display: "inline-block", width: 12, height: 12, background: "#f5f5f5", border: "1px solid #E4EAF6", borderRadius: 3, marginRight: 4 }} />空/未建库位</span>
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 17） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>仓库与货架</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#5B6478" }}>
            仓库 / 货架 / 库位三级管理：库位编码自动生成、2D 分层货架图、按单位过滤
          </p>
        </div>
        <Space>
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<PlusOutlined style={{ color: "#5B7FFF" }} />}
            onClick={() => { if (!selectedWh) { message.warning("请先在左侧选择仓库，再新增货架"); return; } setShelfModal({ open: true, editing: null }); }}>
            新增货架
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setWhModal({ open: true, editing: null })}>新增仓库</Button>
        </Space>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* 左：仓库列表卡（设计页 17：300px 白卡） */}
        <div style={{ flex: "0 0 300px", maxHeight: "calc(100dvh - 200px)", overflow: "auto" }}>
          <div style={{ border: "1px solid #E4EAF6", borderRadius: 16, background: "#FFFFFF", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1E2433" }}>仓库列表</div>
            <Spin spinning={whLoading}>
              {whs.map((w) => {
                const active = selectedWh?.id === w.id;
                return (
                  <div
                    key={w.id}
                    onClick={() => setSelectedWh(w)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: active ? "#EAEFFF" : "#F6F8FE",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? "#3B5BDB" : "#1E2433" }}>{w.name}</div>
                      <div style={{ fontSize: 10.5, color: "#8A93A8", marginTop: 2 }}>
                        {w.code} · {w.shelf_count ?? 0} 货架 · {w.location_count ?? 0} 库位{w.status === 1 ? "" : " · 停用"}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: active ? "#3B5BDB" : "#8A93A8" }}>▸</span>
                  </div>
                );
              })}
              {!whs.length && !whLoading && <Empty description="暂无仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </Spin>
            <div style={{ fontSize: 10.5, color: "#8A93A8" }}>选择仓库后右侧显示分层货架图</div>
          </div>
        </div>

        {/* 右：选中仓库的 2.5D 货架视图（内嵌，无独立页） */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedWh ? (
            <>
              <Space style={{ marginBottom: 10 }} wrap>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{selectedWh.name}</span>
                <Tag>{selectedWh.shelf_count ?? 0} 货架 / {selectedWh.location_count ?? 0} 库位 / {selectedWh.product_kind_count ?? 0} 种材料</Tag>
                <Button size="small" onClick={() => setWhModal({ open: true, editing: selectedWh })}>编辑仓库</Button>
                <Popconfirm
                  title="停用该仓库？"
                  description="有货架或库存时会被系统拒绝"
                  onConfirm={async () => {
                    try {
                      await baseApi.deleteWarehouse(selectedWh.id);
                      message.success("已停用");
                      await loadWhs();
                    } catch (e) {
                      message.error(e instanceof Error ? e.message : "操作失败");
                    }
                  }}
                >
                  <Button size="small" danger>停用</Button>
                </Popconfirm>
                <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => setShelfModal({ open: true, editing: null })}>新建货架</Button>
              </Space>

              {/* 筛选条（设计页 17）：搜索库位/材料 + 汇总胶囊 */}
              <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <Input
                  prefix={<SearchOutlined style={{ color: "#8A93A8" }} />}
                  placeholder="搜索库位 / 材料"
                  allowClear
                  style={{ width: 260, background: "#F6F8FE" }}
                  value={shelfKw}
                  onChange={(e) => setShelfKw(e.target.value)}
                />
                <span style={{ marginLeft: "auto" }}>
                  <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#5B7FFF", borderColor: "transparent", marginInlineEnd: 0 }}>
                    {visibleShelves.length} 货架 · {visibleShelves.reduce((s, x) => s + (x.layers ?? 1) * (x.rows ?? 1) * (x.cols ?? 1), 0)} 库位
                  </Tag>
                </span>
              </div>

              {legend}

              {visibleShelves.length === 0 ? (
                <Empty description={shelves.length ? "无匹配货架" : "暂无货架，点击「新增货架」（按层×行×列批量生成库位）"} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(560px, 1fr))", gap: 14 }}>
                  {visibleShelves.map((s) => (
                    <div key={s.id} style={{ border: "1px solid #E4EAF6", borderRadius: 12, background: "#F8FAFF", padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                        <b>{s.code}{s.name ? ` ${s.name}` : ""}</b>
                        <Space size={4}>
                          <Button size="small" icon={<EditOutlined />} onClick={() => setShelfModal({ open: true, editing: s })}>编辑</Button>
                          <Button size="small" icon={<PlusOutlined />} onClick={() => setLocModal({ open: true, shelf: s })}>新建库位</Button>
                          <Popconfirm
                            title={`删除货架「${s.code}」？`}
                            description="有库位时会被系统拒绝"
                            onConfirm={async () => {
                              try {
                                await baseApi.deleteShelf(s.id);
                                message.success("已删除");
                                await refreshSelected();
                              } catch (e) {
                                message.error(e instanceof Error ? e.message : "删除失败");
                              }
                            }}
                          >
                            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                          </Popconfirm>
                        </Space>
                      </div>
                      <Shelf25D shelf={s} cells={cellMap} onCell={setDetail} />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Empty description="请选择仓库" style={{ marginTop: 80 }} />
          )}
        </div>
      </div>

      {/* 仓库 Modal */}
      <Modal title={whModal.editing ? "编辑仓库" : "新建仓库"} open={whModal.open} onOk={() => void saveWarehouse()} onCancel={() => setWhModal({ open: false, editing: null })} confirmLoading={busy} destroyOnHidden
        afterOpenChange={(o) => { if (!o) return; if (whModal.editing) whForm.setFieldsValue(whModal.editing); else whForm.resetFields(); }}>
        <Form form={whForm} layout="vertical">
          <Form.Item name="name" label="仓库名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如 一号仓" />
          </Form.Item>
          <Form.Item name="address" label="地址"><Input /></Form.Item>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>

      {/* 货架 Modal（新建支持批量生成库位） */}
      <Modal title={shelfModal.editing ? "编辑货架" : "新建货架（按层×行×列批量生成库位）"} open={shelfModal.open} onOk={() => void saveShelf()} onCancel={() => setShelfModal({ open: false, editing: null })} confirmLoading={busy} destroyOnHidden
        afterOpenChange={(o) => { if (!o) return; if (shelfModal.editing) shelfForm.setFieldsValue(shelfModal.editing); else shelfForm.resetFields(); }}>
        <Form form={shelfForm} layout="vertical">
          {!shelfModal.editing && (
            <>
              <Form.Item name="code" label="货架编号" rules={[{ required: true, message: "请输入编号" }]}>
                <Input placeholder="如 A01" />
              </Form.Item>
              <Space wrap>
                <Form.Item name="layers" label="层数" rules={[{ required: true, message: "请输入层数" }]}>
                  <InputNumber min={1} max={99} style={{ width: 110 }} placeholder="如 3" />
                </Form.Item>
                <Form.Item name="rows" label="行数" rules={[{ required: true, message: "请输入行数" }]}>
                  <InputNumber min={1} max={99} style={{ width: 110 }} placeholder="如 2" />
                </Form.Item>
                <Form.Item name="cols" label="列数" rules={[{ required: true, message: "请输入列数" }]}>
                  <InputNumber min={1} max={99} style={{ width: 110 }} placeholder="如 4" />
                </Form.Item>
              </Space>
            </>
          )}
          <Form.Item name="name" label="名称"><Input placeholder="可选" /></Form.Item>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>

      {/* 库位 Modal（单格：层行列） */}
      <Modal title={`新建库位（${locModal.shelf?.code || ""}）`} open={locModal.open} onOk={() => void saveLocation()} onCancel={() => setLocModal({ open: false, shelf: null })} confirmLoading={busy} destroyOnHidden
        afterOpenChange={(o) => { if (o) locForm.resetFields(); }}>
        <Form form={locForm} layout="vertical">
          <Space wrap>
            <Form.Item name="layer_no" label="层号" rules={[{ required: true, message: "请输入层号" }]}>
              <InputNumber min={1} max={99} style={{ width: 110 }} placeholder="如 1" />
            </Form.Item>
            <Form.Item name="row_no" label="行号" rules={[{ required: true, message: "请输入行号" }]}>
              <InputNumber min={1} max={99} style={{ width: 110 }} placeholder="如 1" />
            </Form.Item>
            <Form.Item name="col_no" label="列号" rules={[{ required: true, message: "请输入列号" }]}>
              <InputNumber min={1} max={99} style={{ width: 110 }} placeholder="如 1" />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注"><Input placeholder="可空" maxLength={100} /></Form.Item>
        </Form>
      </Modal>

      {/* 库位明细 */}
      <Modal title={`库位 ${detail?.location_code ?? ""} 明细`} open={Boolean(detail)} onCancel={() => setDetail(null)} footer={null}>
        {detail && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={thStyle}>材料名称</th><th style={thStyle}>数量</th><th style={thStyle}>状态</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.product_id}>
                  <td style={tdStyle}>{it.name} <span style={{ color: "#5B6478" }}>{it.spec}</span></td>
                  <td style={tdStyle}>{it.qty}</td>
                  <td style={tdStyle}><Tag color={ALERT_COLOR[it.alert]}>{ALERT_TEXT[it.alert]}</Tag></td>
                </tr>
              ))}
              {!detail.items.length && <tr><td colSpan={3} style={{ ...tdStyle, textAlign: "center", color: "#5B6478" }}>空库位</td></tr>}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #EFF3FC", background: "#F6F8FE" };
const tdStyle: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #EFF3FC" };
