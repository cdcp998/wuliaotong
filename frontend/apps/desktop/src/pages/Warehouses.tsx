import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Card, Empty, Form, Input, InputNumber, Modal, Popconfirm, Space, Spin, Tag, Typography } from "antd";

import { baseApi, type Location, type Shelf, type Warehouse } from "@wlt/shared";

/** 仓库与货架管理（电脑端）：左侧仓库列表（CRUD）+ 右侧选中仓库的货架/库位（CRUD），自适应填充。 */
export function WarehousesPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [whLoading, setWhLoading] = useState(false);
  const [selectedWh, setSelectedWh] = useState<Warehouse | null>(null);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [locs, setLocs] = useState<Location[]>([]);
  const [busy, setBusy] = useState(false);
  const [whModal, setWhModal] = useState<{ open: boolean; editing: Warehouse | null }>({ open: false, editing: null });
  const [shelfModal, setShelfModal] = useState<{ open: boolean; editing: Shelf | null }>({ open: false, editing: null });
  const [locModal, setLocModal] = useState<{ open: boolean; shelf: Shelf | null }>({ open: false, shelf: null });
  const [whForm] = Form.useForm();
  const [shelfForm] = Form.useForm();
  const [locForm] = Form.useForm();

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
      setLocs([]);
      return;
    }
    baseApi.shelves(selectedWh.id).then(setShelves).catch(() => undefined);
    baseApi.locations(selectedWh.id).then(setLocs).catch(() => undefined);
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
        await baseApi.createWarehouse({ code: v.code || "WH" + Date.now(), name: v.name, address: v.address ?? "", remark: v.remark ?? "" });
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
        await baseApi.createShelf({ warehouse_id: selectedWh.id, code: v.code, name: v.name ?? "", remark: v.remark ?? "" });
        message.success("货架已创建");
      }
      setShelfModal({ open: false, editing: null });
      setShelves(await baseApi.shelves(selectedWh.id));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  // ---------- 库位 ----------
  async function saveLocation() {
    if (!selectedWh || !locModal.shelf) return;
    const v = await locForm.validateFields();
    setBusy(true);
    try {
      await baseApi.createLocation({ warehouse_id: selectedWh.id, shelf_id: locModal.shelf.id, layer_no: v.layer_no, remark: v.remark ?? "" });
      message.success("库位已创建");
      setLocModal({ open: false, shelf: null });
      setLocs(await baseApi.locations(selectedWh.id));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>仓库与货架</Typography.Title>
        <Space>
          {selectedWh && (
            <Button onClick={() => navigate(`/warehouses/${selectedWh.id}/map`)}>查看 2D 货架图</Button>
          )}
          <Button
            type="primary"
            onClick={() => {
              setWhModal({ open: true, editing: null });
            }}
          >
            新建仓库
          </Button>
        </Space>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* 左：仓库列表 */}
        <div style={{ flex: "0 0 240px", maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
          <Spin spinning={whLoading}>
            {whs.map((w) => (
              <div
                key={w.id}
                onClick={() => setSelectedWh(w)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: selectedWh?.id === w.id ? "1px solid #1668dc" : "1px solid #f0f1f3",
                  background: selectedWh?.id === w.id ? "#f0f7ff" : "#fff",
                  cursor: "pointer",
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b>{w.name}</b>
                  {w.status === 1 ? <Tag color="green" style={{ marginInlineEnd: 0 }}>启用</Tag> : <Tag style={{ marginInlineEnd: 0 }}>停用</Tag>}
                </div>
                <div style={{ fontSize: 12, color: "#86909c" }}>{w.code}</div>
              </div>
            ))}
            {!whs.length && !whLoading && <Empty description="暂无仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Spin>
        </div>

        {/* 右：选中仓库的货架/库位 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedWh ? (
            <>
              <Space style={{ marginBottom: 12 }} wrap>
                <span style={{ fontWeight: 600 }}>{selectedWh.name}</span>
                <Button size="small" onClick={() => { setWhModal({ open: true, editing: selectedWh }); }}>编辑仓库</Button>
                <Popconfirm
                  title="停用该仓库？"
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
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => { setShelfModal({ open: true, editing: null }); }}
                >
                  + 新建货架
                </Button>
              </Space>

              {shelves.length === 0 && <Empty description="暂无货架，点击「新建货架」创建" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                {shelves.map((s) => {
                  const shelfLocs = locs.filter((l) => l.shelf_id === s.id);
                  return (
                    <Card key={s.id} size="small" title={`${s.code}${s.name ? ` ${s.name}` : ""}`}
                      extra={
                        <Space>
                          <Button size="small" onClick={() => { setShelfModal({ open: true, editing: s }); }}>编辑</Button>
                          <Popconfirm
                            title="删除该货架？"
                            onConfirm={async () => {
                              try {
                                await baseApi.deleteShelf(s.id);
                                message.success("已删除");
                                setShelves(await baseApi.shelves(selectedWh.id));
                              } catch (e) {
                                message.error(e instanceof Error ? e.message : "删除失败");
                              }
                            }}
                          >
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>
                          <Button size="small" type="primary" ghost onClick={() => { setLocModal({ open: true, shelf: s }); }}>+ 库位</Button>
                        </Space>
                      }
                    >
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {shelfLocs.map((l) => (
                          <span key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "#f0f1f3", borderRadius: 6, fontSize: 12 }}>
                            {l.code}（{l.layer_no} 层）
                            <a
                              style={{ color: "#cf1322", marginLeft: 2 }}
                              onClick={async () => {
                                try {
                                  await baseApi.deleteLocation(l.id);
                                  setLocs(await baseApi.locations(selectedWh.id));
                                } catch (e) {
                                  message.error(e instanceof Error ? e.message : "删除失败");
                                }
                              }}
                            >
                              ✕
                            </a>
                          </span>
                        ))}
                        {!shelfLocs.length && <span style={{ fontSize: 12, color: "#c9cdd4" }}>暂无库位</span>}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          ) : (
            <Empty description="请选择仓库" style={{ marginTop: 80 }} />
          )}
        </div>
      </div>

      {/* 仓库 Modal */}
      <Modal
        title={whModal.editing ? "编辑仓库" : "新建仓库"}
        open={whModal.open}
        onOk={() => void saveWarehouse()}
        onCancel={() => setWhModal({ open: false, editing: null })}
        confirmLoading={busy}
        destroyOnHidden
        afterOpenChange={(o) => { if (!o) return; if (whModal.editing) whForm.setFieldsValue(whModal.editing); else whForm.resetFields(); }}
      >
        <Form form={whForm} layout="vertical">
          <Form.Item name="name" label="仓库名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如 一号仓" />
          </Form.Item>
          <Form.Item name="address" label="地址"><Input /></Form.Item>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>

      {/* 货架 Modal */}
      <Modal
        title={shelfModal.editing ? "编辑货架" : "新建货架"}
        open={shelfModal.open}
        onOk={() => void saveShelf()}
        onCancel={() => setShelfModal({ open: false, editing: null })}
        confirmLoading={busy}
        destroyOnHidden
        afterOpenChange={(o) => { if (!o) return; if (shelfModal.editing) shelfForm.setFieldsValue(shelfModal.editing); else shelfForm.resetFields(); }}
      >
        <Form form={shelfForm} layout="vertical">
          {!shelfModal.editing && (
            <Form.Item name="code" label="货架编号" rules={[{ required: true, message: "请输入编号" }]}>
              <Input placeholder="如 A01" />
            </Form.Item>
          )}
          <Form.Item name="name" label="名称"><Input placeholder="可选" /></Form.Item>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>

      {/* 库位 Modal */}
      <Modal
        title={`新建库位（${locModal.shelf?.code ?? ""}）`}
        open={locModal.open}
        onOk={() => void saveLocation()}
        onCancel={() => setLocModal({ open: false, shelf: null })}
        confirmLoading={busy}
        destroyOnHidden
        afterOpenChange={(o) => { if (o) locForm.resetFields(); }}
      >
        <Form form={locForm} layout="vertical">
          <Form.Item name="layer_no" label="层数" rules={[{ required: true, message: "请输入层数" }]}>
            <InputNumber min={1} style={{ width: 160 }} placeholder="如 1" />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
