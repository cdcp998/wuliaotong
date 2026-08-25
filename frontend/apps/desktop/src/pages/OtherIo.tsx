import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowDownOutlined, ArrowUpOutlined, PictureOutlined, SearchOutlined } from "@ant-design/icons";

import { baseApi, fileApi, fileUrl, otherIoApi, type OtherIoBill, type OtherIoDetail } from "@wlt/shared";

import { BillDetailDrawer } from "../components/BillDetailDrawer";

const OUT_TYPES = ["报废", "报损", "赠品出", "借出", "其他出"]; // 负方向（出库）
const IN_TYPES = ["赠品入", "归还", "其他入"]; // 正方向（入库）
const IO_TYPES = [...OUT_TYPES, ...IN_TYPES]; // 设计页 23：出=红/入=绿 + 借出/归还配对

/** 状态胶囊（设计页 23：已入账/已作废）。 */
const STATUS_META: Record<string, { label: string; fg: string; bg: string }> = {
  "1": { label: "已入账", fg: "#15803D", bg: "#E8F9EF" },
  "-1": { label: "已作废", fg: "#DC2626", bg: "#FDEBEC" },
};

interface Row {
  product_id: number | undefined;
  location_id: number | undefined;
  qty: number;
  photo_file_id?: number; // 报损/其他附照片（设计页 23「报损附照片」）
}

export function OtherIoPage() {
  const { message } = App.useApp();
  const [ioType, setIoType] = useState<string | undefined>();
  const [status, setStatus] = useState<number | undefined>();
  const [keyword, setKeyword] = useState("");
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
      const data = await otherIoApi.list(ioType, status, page, pageSize, keyword);
      setList(data.list);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [ioType, status, keyword, page, pageSize]);

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

  /** 打开新建弹窗（type 预选：出/入），重置表单。 */
  function openCreate(type?: string) {
    setForm({ ioType: type && IO_TYPES.includes(type) ? type : IO_TYPES[0], warehouse_id: 0, remark: "", rows: [] });
    setOpen(true);
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

  const linkBtn = (color: string) => ({ type: "link" as const, size: "small" as const, style: { padding: 0, fontSize: 12.5, color } });

  const columns: ColumnsType<OtherIoBill> = [
    { title: "单号", dataIndex: "bill_no", width: 160, render: (v: string) => <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3B5BDB" }}>{v}</span> },
    {
      title: "类型", dataIndex: "io_type", width: 110,
      render: (v: string) => {
        const isOut = OUT_TYPES.includes(v);
        return <Tag style={{ borderRadius: 999, background: isOut ? "#FDEBEC" : "#E8F9EF", color: isOut ? "#DC2626" : "#15803D", borderColor: "transparent", marginInlineEnd: 0 }}>{v}</Tag>;
      },
    },
    {
      title: "材料", key: "mat", width: 260,
      render: (_, r) => {
        const items = r.items ?? [];
        const first = items[0];
        if (!first) return <span style={{ color: "#8A93A8", fontSize: 12 }}>—</span>;
        return (
          <span style={{ fontSize: 12.5, color: "#1E2433" }}>
            {first.product_name}
            {items.length > 1 && <span style={{ color: "#8A93A8", fontSize: 11 }}> 等 {items.length} 种</span>}
          </span>
        );
      },
    },
    { title: "数量", key: "qty", width: 90, render: (_, r) => <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{(r.items ?? []).reduce((s, it) => s + Number(it.qty || 0), 0).toLocaleString("zh-CN")}</span> },
    { title: "原因/备注", dataIndex: "remark", render: (v?: string) => <span style={{ fontSize: 12, color: "#5B6478" }}>{v || "—"}</span> },
    {
      title: "状态", dataIndex: "status", width: 100,
      render: (s: number) => { const m = STATUS_META[String(s)] ?? { label: String(s), fg: "#5B6478", bg: "#EFF3FC" }; return <Tag style={{ borderRadius: 999, background: m.bg, color: m.fg, borderColor: "transparent", marginInlineEnd: 0 }}>{m.label}</Tag>; },
    },
    { title: "经办人", dataIndex: "operator_name", width: 100, render: (v: string) => <span style={{ fontSize: 12, color: "#5B6478" }}>{v || "—"}</span> },
    { title: "日期", dataIndex: "created_at", width: 130, render: (v: string) => <span style={{ fontSize: 12, color: "#8A93A8", fontVariantNumeric: "tabular-nums" }}>{v ? v.slice(5, 16) : "—"}</span> },
    {
      title: "操作", key: "op", width: 110,
      render: (_, r) => (
        <Space size={10} style={{ padding: "0 10px" }}>
          <Button {...linkBtn("#5B6478")} onClick={() => void openDetail(r)}>详情</Button>
          {r.status === 1 && (
            <Popconfirm title="确认作废（反向冲销库存）？" onConfirm={async () => { try { await otherIoApi.void(r.id); message.success("已作废"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
              <Button {...linkBtn("#DC2626")}>作废</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 23）：新增出库（描边）/ 新增入库（主） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>其他出入库</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#5B6478" }}>
            非采购入库/非领用出库的库存变动（报损/调拨外借/借出归还/工程退料等）
          </p>
        </div>
        <Space>
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<ArrowDownOutlined style={{ color: "#5B7FFF" }} />} onClick={() => openCreate(OUT_TYPES[0])}>新增出库</Button>
          <Button type="primary" icon={<ArrowUpOutlined />} onClick={() => openCreate(IN_TYPES[0])}>新增入库</Button>
        </Space>
      </div>

      {/* 筛选条（设计页 23：搜索 + 类型 + 状态 + 统计） */}
      <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#8A93A8" }} />}
          placeholder="单号 / 材料 / 原因"
          allowClear
          style={{ width: 300, background: "#F6F8FE" }}
          onChange={(e) => { if (!e.target.value) { setKeyword(""); setPage(1); } }}
          onPressEnter={(e) => { setKeyword((e.target as HTMLInputElement).value.trim()); setPage(1); }}
        />
        <Select
          placeholder="全部类型"
          allowClear
          style={{ width: 170 }}
          value={ioType}
          onChange={(v) => { setIoType(v); setPage(1); }}
          options={IO_TYPES.map((t) => ({ label: t, value: t }))}
        />
        <Select
          placeholder="全部状态"
          allowClear
          style={{ width: 170 }}
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[{ value: 1, label: "已入账" }, { value: -1, label: "已作废" }]}
        />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A93A8" }}>共 {total} 条</span>
      </div>

      {/* 表格（设计列：单号/类型/材料/数量/原因备注/状态/经办人/日期） */}
      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<OtherIoBill>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          locale={{ emptyText: "暂无其他出入库单" }}
          pagination={{ current: page, pageSize, total, showTotal: (t) => `共 ${t} 条`, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
        />
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#8A93A8" }}>
          提示：出库默认负数冲减并锁定库存；借出/归还对应台账自动配对，报损需附照片
        </p>
      </div>

      <BillDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="其他出入库详情"
        statusTag={detail ? <Tag style={{ borderRadius: 999, background: STATUS_META[String(detail.status)]?.bg, color: STATUS_META[String(detail.status)]?.fg, borderColor: "transparent" }}>{STATUS_META[String(detail.status)]?.label}</Tag> : undefined}
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
