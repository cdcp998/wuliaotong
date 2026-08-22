import { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { useNavigate } from "react-router";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { InboxOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { baseApi, purchasePlanApi, type PurchasePlanBill } from "@wlt/shared";

const STATUS_META: Record<number, { label: string; color: string }> = {
  0: { label: "草稿", color: "default" },
  1: { label: "已提交", color: "blue" },
  2: { label: "部分入库", color: "orange" },
  3: { label: "已完成", color: "green" },
  "-1": { label: "已作废", color: "red" },
};

interface Row {
  key: number;
  product_id: number | undefined;
  product_name: string;
  planned_qty: number;
  unit_name: string;
  remark: string;
}

/** 采购计划单（电脑端，pch:in）：事物流前置环节 —— 计划 → 材料入库（送货单图片可选存底）→ 库存落账。 */
export function PurchasePlansPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [list, setList] = useState<PurchasePlanBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [billNo, setBillNo] = useState("");
  const [status, setStatus] = useState<number | undefined>(undefined);

  // 新建/编辑弹窗
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PurchasePlanBill | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(1);
  // 材料行搜索候选（服务端防抖）
  const [matOptions, setMatOptions] = useState<Record<number, { value: number; label: string }[]>>({});
  const matDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 明细详情（查看计划 vs 已入库）
  const [detail, setDetail] = useState<PurchasePlanBill | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await purchasePlanApi.list({ billNo, status, page, pageSize });
      setList(d.list);
      setTotal(d.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [billNo, status, page, pageSize, message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.warehouses().then((ws) => setWarehouses(ws.map((w) => ({ id: w.id, name: w.name })))).catch(() => undefined);
  }, []);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setRows([]);
    setNextKey(1);
    setMatOptions({});
    setOpen(true);
  }

  function openEdit(p: PurchasePlanBill) {
    setEditing(p);
    form.setFieldsValue({
      warehouse_id: p.warehouse_id,
      plan_date: p.plan_date ? dayjs(p.plan_date) : undefined,
      remark: p.remark,
    });
    setRows(
      p.items.map((it, i) => ({
        key: i + 1,
        product_id: it.product_id,
        product_name: it.product_name,
        planned_qty: Number(it.planned_qty || 0),
        unit_name: it.unit_name,
        remark: it.remark,
      }))
    );
    setNextKey(p.items.length + 1);
    setMatOptions({});
    setOpen(true);
  }

  /** 材料名称/编码行搜索（服务端防抖，候选含完整材料）。 */
  function searchMat(rowKey: number, kw: string) {
    if (matDebounce.current) clearTimeout(matDebounce.current);
    const k = kw.trim();
    if (!k) return;
    matDebounce.current = setTimeout(() => {
      void baseApi.products(k, 1, { status: 1, pageSize: 20 }).then((d) => {
        setMatOptions((old) => ({
          ...old,
          [rowKey]: d.list.map((p) => ({ value: p.id, label: `${p.name}${p.spec ? `（${p.spec}）` : ""} · ${p.material_code || p.code || "-"}` })),
        }));
      }).catch(() => undefined);
    }, 300);
  }

  function addRow() {
    setRows((rs) => [...rs, { key: nextKey, product_id: undefined, product_name: "", planned_qty: 1, unit_name: "", remark: "" }]);
    setNextKey((k) => k + 1);
  }

  function setRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** 保存（submit=true 时保存并直接提交计划）。 */
  async function save(submit: boolean) {
    const v = await form.validateFields();
    const validRows = rows.filter((r) => r.product_id);
    if (!validRows.length) {
      message.warning("请至少添加一条计划明细");
      return;
    }
    if (validRows.some((r) => !(r.planned_qty > 0))) {
      message.warning("计划数量必须大于 0");
      return;
    }
    const body = {
      supplier_id: 0, // 供应商已从新建界面移除
      warehouse_id: v.warehouse_id,
      plan_date: v.plan_date ? v.plan_date.format("YYYY-MM-DD HH:mm:ss") : undefined,
      remark: v.remark ?? "",
      items: validRows.map((r) => ({
        product_id: r.product_id!,
        planned_qty: String(r.planned_qty),
        unit_name: r.unit_name ?? "",
        remark: r.remark ?? "",
      })),
    };
    setSaving(true);
    try {
      let id = editing?.id ?? 0;
      if (editing) {
        await purchasePlanApi.update(editing.id, body);
        message.success("采购计划单已更新");
      } else {
        const p = await purchasePlanApi.create(body);
        id = p.id;
        message.success(`采购计划单已创建：${p.bill_no}`);
      }
      if (submit) {
        await purchasePlanApi.submit(id);
        message.success(submit ? "已提交计划（可据此入库）" : "已保存");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const columns: ColumnsType<PurchasePlanBill> = [
    { title: "计划单号", dataIndex: "bill_no", width: 150 },
    { title: "仓库", dataIndex: "warehouse_name", width: 130 },
    { title: "计划数量", dataIndex: "total_qty", width: 100, align: "right" as const },
    { title: "明细", dataIndex: "items", width: 80, align: "center" as const, render: (_: unknown, r) => r.items?.length ?? 0 },
    { title: "计划日期", dataIndex: "plan_date", width: 140, render: (v: string) => (v ? v.slice(0, 16) : "-") },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: number) => <Tag color={STATUS_META[v]?.color}>{STATUS_META[v]?.label ?? v}</Tag>,
    },
    {
      title: "操作",
      key: "op",
      width: 240,
      render: (_, r) => (
        <Space size={4} wrap>
          <Button size="small" onClick={() => setDetail(r)}>查看</Button>
          {r.status === 0 && (
            <>
              <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
              <Button size="small" type="primary" ghost onClick={() => void submitPlan(r)}>提交</Button>
            </>
          )}
          {(r.status === 1 || r.status === 2) && (
            <Button size="small" type="primary" icon={<InboxOutlined />} onClick={() => navigate(`/purchase-in?plan_id=${r.id}`)}>
              去入库
            </Button>
          )}
          {r.status !== -1 && r.status !== 3 && (
            <Popconfirm title={`确认作废计划单「${r.bill_no}」？`} onConfirm={() => void voidPlan(r)}>
              <Button size="small" danger>作废</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  async function submitPlan(p: PurchasePlanBill) {
    try {
      await purchasePlanApi.submit(p.id);
      message.success("已提交");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function voidPlan(p: PurchasePlanBill) {
    try {
      await purchasePlanApi.void(p.id);
      message.success("已作废");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  const detailColumns: ColumnsType<PurchasePlanBill["items"][number]> = [
    { title: "材料", dataIndex: "product_name", render: (v: string, r) => <span>{v} <span style={{ color: "#646a73" }}>{r.code}</span></span> },
    { title: "计划数量", dataIndex: "planned_qty", width: 100, align: "right" as const },
    {
      title: "已入库",
      dataIndex: "received_qty",
      width: 100,
      align: "right" as const,
      render: (v: string, r) => <span style={{ color: Number(v) >= Number(r.planned_qty) ? "#52c41a" : "#fa8c16" }}>{v}</span>,
    },
    { title: "单位", dataIndex: "unit_name", width: 70 },
    { title: "备注", dataIndex: "remark", render: (v?: string) => v || "-" },
  ];

  // 明细表行合计
  const totalQty = rows.reduce((s, r) => s + (r.planned_qty > 0 ? r.planned_qty : 0), 0);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>采购计划单</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#646a73" }}>
            事物流：采购计划单 → 材料入库（送货单图片可选存底）→ 库存落账；计划按累计实收自动推进状态
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建采购计划</Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search placeholder="计划单号" allowClear style={{ width: 180 }} onSearch={(v) => { setBillNo(v.trim()); setPage(1); }} />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 130 }}
          value={status}
          options={Object.entries(STATUS_META).map(([v, m]) => ({ value: Number(v), label: m.label }))}
          onChange={(v) => { setStatus(v); setPage(1); }}
        />
      </Space>

      <Table<PurchasePlanBill>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={list}
        loading={loading}
        locale={{ emptyText: "暂无采购计划单" }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            if (ps !== pageSize) {
              setPage(1);
              setPageSize(ps);
            } else {
              setPage(p);
            }
          },
        }}
      />

      {/* ===== 新建 / 编辑（方案 A：基本信息卡片 + 明细表格 + 双按钮） ===== */}
      <Modal
        title={editing ? `编辑采购计划单：${editing.bill_no}` : "新建采购计划单"}
        open={open}
        onOk={() => void save(false)}
        okText="保存草稿"
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        width={860}
        destroyOnHidden
        footer={
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button loading={saving} onClick={() => void save(false)}>保存草稿</Button>
            <Button type="primary" loading={saving} onClick={() => void save(true)}>提交计划</Button>
          </Space>
        }
        styles={{ body: { maxHeight: "calc(100dvh - 260px)", overflow: "auto" } }}
      >
        {/* 基本信息卡片 */}
        <div style={{ padding: 12, border: "1px solid #e5e6eb", borderRadius: 8, background: "#fafbfc", marginBottom: 12 }}>
          <Form form={form} layout="vertical">
            <Space size={16} wrap>
              <Form.Item name="warehouse_id" label="入库仓库" rules={[{ required: true, message: "请选择仓库" }]} style={{ width: 220, marginBottom: 0 }}>
                <Select placeholder="选择仓库" options={warehouses} fieldNames={{ label: "name", value: "id" }} />
              </Form.Item>
              <Form.Item name="plan_date" label="计划日期" style={{ width: 180, marginBottom: 0 }}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="remark" label="备注" style={{ width: 320, marginBottom: 0 }}>
                <Input maxLength={255} placeholder="可选" />
              </Form.Item>
            </Space>
          </Form>
        </div>

        {/* 计划明细表格 */}
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          计划明细{rows.length ? ` · ${rows.length} 种材料 · 计划数量合计 ${totalQty}` : ""}
        </div>
        <div style={{ border: "1px solid #f0f0f0", borderRadius: 8 }}>
          <Table<Row>
            rowKey="key"
            size="small"
            dataSource={rows}
            pagination={false}
            locale={{ emptyText: "暂无明细，点击下方「添加明细」" }}
            columns={[
              {
                title: "材料名称 / 编码",
                key: "product",
                width: 340,
                render: (_, r) => (
                  <Select
                    style={{ width: "100%" }}
                    placeholder="🔍 搜索材料名称 / 编码 / 规格"
                    showSearch
                    filterOption={false}
                    onSearch={(kw) => searchMat(r.key, kw)}
                    value={r.product_id}
                    options={matOptions[r.key] ?? []}
                    onChange={(v) => setRow(r.key, { product_id: v })}
                    suffixIcon={null}
                  />
                ),
              },
              {
                title: "计划数量",
                key: "qty",
                width: 140,
                render: (_, r) => (
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0.001}
                    precision={3}
                    placeholder="数量"
                    value={r.planned_qty}
                    onChange={(v) => setRow(r.key, { planned_qty: Number(v ?? 0) })}
                  />
                ),
              },
              {
                title: "备注",
                key: "remark",
                render: (_, r) => (
                  <Input maxLength={200} placeholder="可选" value={r.remark} onChange={(e) => setRow(r.key, { remark: e.target.value })} />
                ),
              },
              {
                title: "操作",
                key: "op",
                width: 60,
                render: (_, r) => (
                  <Button size="small" danger type="text" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>删</Button>
                ),
              },
            ]}
          />
          <div style={{ padding: "6px 12px", borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
            <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addRow}>添加明细</Button>
            <span style={{ fontSize: 12, color: "#646a73" }}>实收数量在入库时按实际填写，可分批多次入库</span>
          </div>
        </div>
      </Modal>

      {/* 详情（计划 vs 已入库） */}
      <Modal title={`计划单详情：${detail?.bill_no ?? ""}`} open={Boolean(detail)} onCancel={() => setDetail(null)} footer={null} width={640}>
        {detail && (
          <div>
            <Space style={{ marginBottom: 12 }} wrap>
              <span>仓库：{detail.warehouse_name}</span>
              <span>计划日期：{detail.plan_date?.slice(0, 16)}</span>
              <span>计划数量合计：{detail.total_qty}</span>
              {detail.remark && <span>备注：{detail.remark}</span>}
              <Tag color={STATUS_META[detail.status]?.color}>{STATUS_META[detail.status]?.label}</Tag>
            </Space>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.items}
              columns={detailColumns}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
