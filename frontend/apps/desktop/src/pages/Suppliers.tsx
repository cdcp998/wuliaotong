import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ExportOutlined, ImportOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";

import { baseApi, type Product, type Supplier, type SupplierInput } from "@wlt/shared";

/** 简称归一（设计页 15「简称归一 / 待合并」）：剥离常见公司后缀并去空白、转小写，得到归一简称。 */
function normShort(name: string): string {
  return name
    .replace(/(股份有限公司|有限责任公司|有限公司|公司)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 时间 → YYYY-MM-DD（最近供货列）。 */
function fmtDate(v?: string): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

/** 供应商管理（设计页 15，电脑端，base:supplier）：新建/编辑/停用、Excel 导入/导出、简称归一标注「待合并」、查看关联材料。 */
export function SuppliersPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [list, setList] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [enabledTotal, setEnabledTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form] = Form.useForm();
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 查看详情：供应商信息 + 关联材料
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [detailProducts, setDetailProducts] = useState<Product[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  // 简称归一「待合并」：归一简称冲突的供应商集合
  const [dupIds, setDupIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 服务端搜索 + 分页（全库匹配），避免此前只加载前 100 条再本地过滤导致搜不到较旧供应商
      const data = await baseApi.suppliers(status, keyword.trim(), page, 20);
      setList(data.list);
      setTotal(data.total);
      // 启用数（筛选卡右侧「启用 N」，设计页 15）
      const en = await baseApi.suppliers(1, "", 1, 1);
      setEnabledTotal(en.total);
    } finally {
      setLoading(false);
    }
  }, [keyword, status, page]);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  // 简称归一：分页取全部启用供应商，归一简称，冲突者标记「待合并」（不影响主列表）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all: Supplier[] = [];
        for (let p = 1; p <= 5; p++) {
          const d = await baseApi.suppliers(1, "", p, 100);
          all.push(...d.list);
          if (all.length >= d.total) break;
        }
        if (!alive) return;
        const groups = new Map<string, number[]>();
        for (const s of all) {
          const k = normShort(s.name);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(s.id);
        }
        const dup = new Set<number>();
        for (const ids of groups.values()) if (ids.length > 1) ids.forEach((id) => dup.add(id));
        setDupIds(dup);
      } catch {
        /* 简称归一失败不影响主列表 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setOpen(true);
  }

  async function save() {
    const v = await form.validateFields();
    const body: SupplierInput = {
      code: editing ? editing.code : "SUP" + Date.now(),
      name: v.name.trim(),
      contact: v.contact ?? "",
      phone: v.phone ?? "",
      address: v.address ?? "",
      remark: v.remark ?? "",
    };
    try {
      if (editing) {
        await baseApi.updateSupplier(editing.id, body);
        message.success("供应商已更新");
      } else {
        await baseApi.createSupplier(body);
        message.success("供应商已创建");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function toggleStatus(s: Supplier) {
    try {
      await baseApi.updateSupplier(s.id, { code: s.code, name: s.name, status: s.status === 1 ? 0 : 1 });
      message.success(s.status === 1 ? "已停用" : "已启用");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function remove(s: Supplier) {
    try {
      await baseApi.deleteSupplier(s.id);
      message.success("已停用该供应商");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "停用失败");
    }
  }

  async function openDetail(s: Supplier) {
    setDetail(s);
    setDetailProducts([]);
    setDetailLoading(true);
    try {
      const data = await baseApi.supplierProducts(s.id);
      setDetailProducts(data.list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载关联材料失败");
    } finally {
      setDetailLoading(false);
    }
  }

  /** Excel 导入（xlsx：表头 编码/名称/联系人/电话/地址）。 */
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // 允许重复选择同一文件
    if (!f) return;
    try {
      const r = await baseApi.supplierImport(f);
      const fail = r.fail_rows.length
        ? `，失败 ${r.fail_rows.length} 行（${r.fail_rows.slice(0, 3).map((x) => `第${x.row}行 ${x.reason}`).join("；")}${r.fail_rows.length > 3 ? "…" : ""}）`
        : "";
      message.success(`已导入 ${r.success_count} 个供应商${fail}`);
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导入失败");
    }
  }

  /** 导出当前筛选结果（编码/名称/联系人/电话/地址/状态）。 */
  async function onExport() {
    try {
      const all: Supplier[] = [];
      for (let p = 1; p <= 10; p++) {
        const d = await baseApi.suppliers(status, keyword.trim(), p, 100);
        all.push(...d.list);
        if (all.length >= d.total) break;
      }
      const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
      const csv = [
        ["编码", "名称", "联系人", "电话", "地址", "状态"].join(","),
        ...all.map((s) => [s.code, s.name, s.contact, s.phone, s.address, s.status === 1 ? "启用" : "停用"].map(esc).join(",")),
      ].join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `供应商_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    }
  }

  const columns: ColumnsType<Supplier> = [
    {
      title: "供应商", key: "name", width: 320,
      render: (_, s) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: "#1E2433" }}>{s.name}</span>
          {dupIds.has(s.id) && (
            <span className="wlt-pill" style={{ background: "#FEF4E2", color: "#B45309" }} title="多个供应商简称归一后相同，建议合并">待合并</span>
          )}
        </span>
      ),
    },
    { title: "编码", dataIndex: "code", width: 120, render: (v: string) => <span style={{ fontSize: 12, color: "#5B6478", fontVariantNumeric: "tabular-nums" }}>{v}</span> },
    { title: "联系人", dataIndex: "contact", width: 120, render: (v: string) => v || "—" },
    { title: "电话", dataIndex: "phone", width: 150, render: (v: string) => v || "—" },
    { title: "最近供货", dataIndex: "last_supply_at", width: 150, render: (v?: string) => <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: v ? token.colorTextSecondary : token.colorTextTertiary }}>{fmtDate(v)}</span> },
    {
      title: "状态", dataIndex: "status", width: 100,
      render: (v: number) => (v === 1
        ? <Tag style={{ borderRadius: 999, background: "#E8F9EF", color: "#15803D", borderColor: "transparent", marginInlineEnd: 0 }}>启用</Tag>
        : <Tag style={{ borderRadius: 999, background: "#EFF3FC", color: "#5B6478", borderColor: "transparent", marginInlineEnd: 0 }}>停用</Tag>),
    },
    {
      title: "操作", key: "op", width: 170,
      render: (_, s) => (
        <Space size={10}>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#5B6478" }} onClick={() => void openDetail(s)}>查看材料</Button>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#5B6478" }} onClick={() => openEdit(s)}>编辑</Button>
          {s.status === 1 ? (
            <Popconfirm title="确认停用该供应商？停用前需先解除其关联的启用材料。" onConfirm={() => void remove(s)}>
              <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#DC2626" }}>停用</Button>
            </Popconfirm>
          ) : (
            <Button type="link" size="small" style={{ padding: 0, fontSize: 12.5, color: "#5B7FFF" }} onClick={() => void toggleStatus(s)}>启用</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头（设计页 15）：标题 + 副题 + 右侧 导入/导出/新增 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>供应商管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            供应商档案：编码自动生成、简称归一（自动合并重复供应商）、采购价关联
          </p>
        </div>
        <Space>
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<ImportOutlined style={{ color: "#5B7FFF" }} />} onClick={() => fileRef.current?.click()}>Excel 导入</Button>
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<ExportOutlined style={{ color: "#5B7FFF" }} />} onClick={() => void onExport()}>导出</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增供应商</Button>
        </Space>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => void onImportFile(e)} />
      </div>

      {/* 筛选条（设计页 15：搜索 + 状态 + 统计） */}
      <div className="wlt-glass" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#8A93A8" }} />}
          placeholder="供应商名称 / 编码 / 联系人"
          allowClear
          style={{ width: 300, background: "#F6F8FE" }}
          onChange={(e) => { if (!e.target.value) { setKeyword(""); setPage(1); } }}
          onPressEnter={(e) => { setKeyword((e.target as HTMLInputElement).value.trim()); setPage(1); }}
        />
        <Select
          placeholder="全部状态"
          allowClear
          style={{ width: 160 }}
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[{ value: 1, label: "启用" }, { value: 0, label: "停用" }]}
        />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8A93A8" }}>共 {total} 家 · 启用 {enabledTotal}</span>
      </div>

      {/* 表格（设计列：供应商/编码/联系人/电话/最近供货/状态/操作） */}
      <div className="wlt-glass" style={{ padding: 12 }}>
        <Table<Supplier>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          locale={{ emptyText: "暂无供应商" }}
          pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: (p) => setPage(p) }}
        />
      </div>

      <Modal
        title={editing ? `编辑供应商：${editing.name}` : "新建供应商"}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        width={520}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (!o) return;
          if (editing) form.setFieldsValue({ code: editing.code, name: editing.name, contact: editing.contact, phone: editing.phone, address: editing.address, remark: editing.remark });
          else form.resetFields();
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如：XX五金有限公司" maxLength={100} />
          </Form.Item>
          <Form.Item name="contact" label="联系人">
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `供应商：${detail.name}` : "供应商详情"}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size={640}
      >
        {detail && (
          <>
            <Space style={{ marginBottom: 16 }} size={4} direction="vertical">
              <div>编码：{detail.code}　联系人：{detail.contact || "-"}　电话：{detail.phone || "-"}</div>
              <div>地址：{detail.address || "-"}</div>
              <div>备注：{detail.remark || "-"}</div>
              <Tag style={{ borderRadius: 999, background: detail.status === 1 ? "#E8F9EF" : "#EFF3FC", color: detail.status === 1 ? "#15803D" : "#5B6478", borderColor: "transparent" }}>{detail.status === 1 ? "启用" : "停用"}</Tag>
            </Space>
            <h4 style={{ margin: "0 0 8px" }}>关联材料（{detailProducts.length}）</h4>
            <Table<Product>
              rowKey="id"
              size="small"
              loading={detailLoading}
              locale={{ emptyText: "暂无关联材料，可在「材料管理」编辑材料时关联" }}
              pagination={false}
              columns={[
                { title: "物料编码", dataIndex: "material_code", render: (v: string) => v || "-" },
                { title: "条码", dataIndex: "barcode", render: (v: string) => v || "-" },
                { title: "材料名称", dataIndex: "name" },
                { title: "型号规格", dataIndex: "spec", render: (v: string) => v || "-" },
                { title: "单位", dataIndex: "unit_name", width: 70 },
                {
                  title: "状态", dataIndex: "status", width: 70,
                  render: (v: number) => (v === 1
                    ? <Tag style={{ borderRadius: 999, background: "#E8F9EF", color: "#15803D", borderColor: "transparent", marginInlineEnd: 0 }}>启用</Tag>
                    : <Tag style={{ borderRadius: 999, background: "#EFF3FC", color: "#5B6478", borderColor: "transparent", marginInlineEnd: 0 }}>停用</Tag>),
                },
              ]}
              dataSource={detailProducts}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
