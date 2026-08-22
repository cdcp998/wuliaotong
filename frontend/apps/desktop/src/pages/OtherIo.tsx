import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, InputNumber, Modal, Popconfirm, Radio, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PictureOutlined } from "@ant-design/icons";

import { baseApi, fileApi, fileUrl, otherIoApi, type OtherIoBill, type OtherIoDetail } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

import { BillDetailDrawer } from "../components/BillDetailDrawer";

const OUT_TYPES = ["报废", "报损", "赠品出", "借出", "其他出"]; // 负方向（出库）
const IO_TYPES = [...OUT_TYPES, "赠品入", "归还", "其他入"]; // 设计页 23：出=红/入=绿 + 借出/归还配对

interface Row {
  product_id: number | undefined;
  location_id: number | undefined;
  qty: number;
  photo_file_id?: number; // 报损/其他附照片（设计页 23「报损附照片」）
}

export function OtherIoPage() {
  const { message } = App.useApp();
  const [ioType, setIoType] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<OtherIoBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: number; name: string; code: string }[]>([]);
  const [locs, setLocs] = useState<{ id: number; display: string }[]>([]);
  const [form, setForm] = useState({ ioType: IO_TYPES[0], warehouse_id: 0, remark: "", rows: [] as Row[] });
  const [borrows, setBorrows] = useState<{ id: number; bill_no: string; created_at: string }[]>([]); // 未归还的借出单（设计页23 归还配对）
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<OtherIoDetail | null>(null);
  const rowFileRef = useRef<HTMLInputElement>(null); // 报损明细照片上传输入
  const rowPhotoRef = useRef(0); // 当前上传照片的明细行下标

  async function openDetail(r: OtherIoBill) {
    try {
      setDetail(await otherIoApi.detail(r.id));
      setDetailOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
    const data = await otherIoApi.list(ioType, undefined, page, pageSize);
    setList(data.list);
    setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [ioType, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    baseApi.warehouses().then((ws) => setWarehouses(ws.filter((w) => w.status === 1).map((w) => ({ id: w.id, name: w.name }))));
    baseApi.products("", 1).then((p) => setProducts(p.list));
  }, []);

  async function loadLocs(whId: number) {
    setLocs((await baseApi.locations(whId)).map((l) => ({ id: l.id, display: l.display ?? l.code })));
  }

  /** 拉取未归还的借出单（用于「归还」关联借出 配对）。 */
  async function loadBorrows() {
    try {
      const d = await otherIoApi.list("借出", 1, 1, 100);
      setBorrows(d.list.map((b) => ({ id: b.id, bill_no: b.bill_no, created_at: b.created_at })));
      if (d.list.length === 0) setForm((f) => ({ ...f, remark: "" }));
    } catch {
      /* 借出单获取失败不阻塞 */
    }
  }

  function setRow(i: number, patch: Partial<Row>) {
    setForm((f) => ({ ...f, rows: f.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }

  async function create() {
    const items = form.rows.filter((r) => r.product_id && r.location_id && r.qty > 0);
    if (!items.length) return message.warning("请至少添加一条有效明细");
    if (form.ioType === "报损" && items.some((r) => !r.photo_file_id)) return message.warning("报损需为每条明细附现场照片");
    const payload = items.map((r) => ({ product_id: r.product_id!, qty: String(r.qty), location_id: r.location_id!, photo_file_id: r.photo_file_id ?? 0 }));
    try {
      const data = await otherIoApi.create(form.ioType, form.warehouse_id, payload, form.remark);
      message.success(`${form.ioType}成功：${data.bill_no}`);
      setOpen(false);
      setForm({ ioType: IO_TYPES[0], warehouse_id: 0, remark: "", rows: [] });
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  /** 单据明细拍照上传（报损留痕）。 */
  async function uploadRowPhoto(i: number, f: File | undefined) {
    if (!f) return;
    try {
      const up = await fileApi.upload(f, "other");
      setRow(i, { photo_file_id: up.file_id });
      message.success("照片已上传");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    }
  }

  const columns: ColumnsType<OtherIoBill> = [
    { title: "单号", dataIndex: "bill_no", render: (v: string, r) => <a onClick={() => void openDetail(r)}>{v}</a> },
    { title: "类型", dataIndex: "io_type", render: (v: string) => {
      const isOut = OUT_TYPES.includes(v);
      return <span className="wlt-pill" style={{ background: isOut ? "#FDEBEC" : "#E8F9EF", color: isOut ? "#DC2626" : "#15803D" }}>{v}</span>;
    } },
    { title: "仓库", dataIndex: "warehouse_name" },
    { title: "操作人", dataIndex: "operator_name" },
    { title: "状态", dataIndex: "status", render: (s: number) => ({ 1: "已过账", "-1": "已作废" })[String(s)] ?? s },
    {
      title: "操作",
      render: (_, r) =>
        r.status === 1 ? (
          <Popconfirm title="确认作废（反向冲销库存）？" onConfirm={async () => { try { await otherIoApi.void(r.id); message.success("已作废"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
            <Button size="small" danger>作废</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>其他出入库</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Radio.Group value={ioType} onChange={(e) => { setIoType(e.target.value); setPage(1); }} optionType="button" size="small">
          <Radio.Button value={undefined}>全部</Radio.Button>
          {IO_TYPES.map((t) => (
            <Radio.Button key={t} value={t}>{t}</Radio.Button>
          ))}
        </Radio.Group>
        <Button type="primary" onClick={() => setOpen(true)}>新建</Button>
      </Space>
      <DataTable rowKey="id" loading={loading} columns={columns} dataSource={list} pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}  rowSelection onBatchDelete={async (keys) => { for (const k of keys) await otherIoApi.void(Number(k)); message.success(`已作废 ${keys.length} 张单据`); void load(); }} />

      <BillDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="其他出入库详情"
        statusTag={detail ? <Tag color={detail.status === 1 ? "green" : "default"}>{detail.status === 1 ? "已过账" : "已作废"}</Tag> : undefined}
        fields={[
          { label: "单号", value: detail?.bill_no },
          { label: "类型", value: detail?.io_type },
          { label: "仓库", value: detail?.warehouse_name },
          { label: "操作人", value: detail?.operator_name },
          { label: "时间", value: detail?.created_at?.slice(0, 16) },
          { label: "备注", value: detail?.remark, span: 2 },
        ]}
        columns={[
          { title: "材料", dataIndex: "product_name", render: (v, r) => <div><b>{v}</b><div style={{ fontSize: 11, color: "#5B6478" }}>{r.spec || "-"}</div></div> },
          { title: "库位", dataIndex: "location_code", width: 120 },
          { title: "数量", dataIndex: "qty", width: 90, align: "right" as const },
          { title: "照片", dataIndex: "photo_file_id", width: 90, render: (v: number | undefined) => (v ? <img src={fileUrl(v)} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #E4EAF6", cursor: "zoom-in" }} onClick={() => v && window.open(fileUrl(v), "_blank")} /> : <span style={{ color: "#c9cdd4", fontSize: 12 }}>—</span>) },
        ]}
        rows={(detail?.items ?? []).map((it) => ({ ...it, key: it.id ?? it.product_id ?? Math.random() }))}
      />

      <Modal title="新建其他出入库" open={open} onOk={() => void create()} onCancel={() => setOpen(false)} width={680}>
        <Space style={{ marginBottom: 12 }}>
          <span>类型</span>
          <Select style={{ width: 140 }} options={IO_TYPES.map((t) => ({ label: t, value: t }))} value={form.ioType} onChange={(v) => setForm((f) => ({ ...f, ioType: v }))} />
          <span>仓库</span>
          <Select style={{ width: 180 }} placeholder="选择" options={warehouses} fieldNames={{ label: "name", value: "id" }} value={form.warehouse_id || undefined} onChange={(v) => { setForm((f) => ({ ...f, warehouse_id: v })); void loadLocs(v); }} />
        </Space>
        {form.ioType === "归还" && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ marginRight: 8 }}>关联借出单</span>
            <Select
              style={{ width: 380 }}
              placeholder="选择对应借出单（未归还）"
              options={borrows.map((b) => ({ label: `${b.bill_no}（${b.created_at}）`, value: b.id }))}
              value={borrows.find((b) => `借出单号:${b.bill_no}` === form.remark)?.id}
              onChange={(v) => {
                const b = borrows.find((x) => x.id === v);
                setForm((f) => ({ ...f, remark: b ? `借出单号:${b.bill_no}` : "" }));
              }}
              onDropdownVisibleChange={(o) => { if (o) void loadBorrows(); }}
            />
            <span style={{ fontSize: 11.5, color: "#8A93A8", marginLeft: 8 }}>归还时关联原借出单，实现借出/归还配对</span>
          </div>
        )}
        {form.rows.map((r, i) => (
          <Space key={i} style={{ marginBottom: 8 }} wrap>
            <Select style={{ width: 200 }} showSearch placeholder="材料" options={products} fieldNames={{ label: "name", value: "id" }} filterOption={(input, o) => String((o as { name?: string }).name ?? "").includes(input)} value={r.product_id} onChange={(v) => setRow(i, { product_id: v })} />
            <Select style={{ width: 140 }} placeholder="库位" options={locs} fieldNames={{ label: "display", value: "id" }} value={r.location_id} onChange={(v) => setRow(i, { location_id: v })} />
            <InputNumber min={0.001} placeholder="数量" value={r.qty} onChange={(v) => setRow(i, { qty: v ?? 0 })} />
            {form.ioType === "报损" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {r.photo_file_id ? (
                  <img src={fileUrl(r.photo_file_id)} alt="报损照片" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #E4EAF6" }} title="现场照片已附" />
                ) : (
                  <span style={{ fontSize: 12, color: "#B45309" }}>待附照片</span>
                )}
                <Button size="small" icon={<PictureOutlined />} title="附现场照片（报损必填）" onClick={() => { rowPhotoRef.current = i; rowFileRef.current?.click(); }}>照片</Button>
              </span>
            )}
            <Button size="small" danger onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((_, idx) => idx !== i) }))}>删</Button>
          </Space>
        ))}
        <Button block onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { product_id: undefined, location_id: undefined, qty: 1 }] }))}>+ 添加明细</Button>
        <input ref={rowFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void uploadRowPhoto(rowPhotoRef.current, e.target.files?.[0]); e.target.value = ""; }} />
      </Modal>
    </div>
  );
}
