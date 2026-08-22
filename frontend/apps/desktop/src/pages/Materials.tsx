import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Tag, Typography } from "antd";
import { CameraOutlined, PictureOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { baseApi, fileApi, ocrApi, type CategoryNode, type Product, type ProductInput } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 材料挂载分类候选（三级体系）：二级 + 三级分类，显示完整路径；顶级分类只作分组。 */
function leafCats(nodes: CategoryNode[]): { id: number; name: string }[] {
  const out: { id: number; name: string }[] = [];
  for (const n of nodes) {
    n.children?.forEach((c) => {
      out.push({ id: c.id, name: `${n.name}/${c.name}` });
      c.children?.forEach((g) => out.push({ id: g.id, name: `${n.name}/${c.name}/${g.name}` }));
    });
  }
  return out;
}

/** 材料管理（电脑端，base:product）：材料的增删改查 + 条码维护，供入库扫码/OCR 识别匹配。 */
export function MaterialsPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [barcode, setBarcode] = useState("");
  const [units, setUnits] = useState<{ id: number; name: string }[]>([]);
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const supDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); // 供应商服务端搜索防抖
  const [open, setOpen] = useState(false);
  // 材料查重（P9-P1②）：扫描分组展示 + 人工标记重复
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [dedupeGroups, setDedupeGroups] = useState<{ group: { product_id: number; name: string; spec: string; material_code: string; unit_name: string }[]; reason: string; confidence: string }[]>([]);
  const [dedupeLoading, setDedupeLoading] = useState(false);
  const [aiKeywords, setAiKeywords] = useState<string[]>([]); // 语义搜索扩展词提示
  const [editing, setEditing] = useState<Product | null>(null);
  const [form] = Form.useForm();
  // Space.Compact 内的表单控件拿不到 Form.Item 注入的 value/onChange（antd v6 只注入直接子元素）→ 显式受控
  const nameValue = Form.useWatch("name", form);
  const barcodeValue = Form.useWatch("barcode", form);
  const categoryValue = Form.useWatch("category_id", form);
  const nameFileRef = useRef<HTMLInputElement>(null); // 材料名称：相机 OCR 识别
  const barcodeFileRef = useRef<HTMLInputElement>(null); // 条码：相机扫码解码
  const nameAlbumRef = useRef<HTMLInputElement>(null); // 材料名称：相册选图 OCR
  const barcodeAlbumRef = useRef<HTMLInputElement>(null); // 条码：相册选图解码

  const load = useCallback(async () => {
    setLoading(true);
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
      let data = await baseApi.products(keyword, page, { barcode, status: 1, pageSize });
      // 语义搜索（P9-P2⑧）：关键词无结果时用大模型改写候选词重试
      let aiKws: string[] = [];
      if (!data.total && keyword && page === 1) {
        const expanded = await baseApi.products(keyword, 1, { barcode, status: 1, pageSize, ai: 1 });
        if (expanded.total) {
          data = expanded as typeof data & { ai_keywords?: string[] };
          aiKws = (expanded as { ai_keywords?: string[] }).ai_keywords ?? [];
        }
      }
      setList(data.list);
      setTotal(data.total);
      setAiKeywords(aiKws);
    } finally {
      setLoading(false);
    }
  }, [keyword, barcode, page, pageSize]);

  useEffect(() => {
    void load().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [load]);

  useEffect(() => {
    baseApi.units().then(setUnits).catch(() => undefined);
    baseApi.categories().then((cs) => setCats(leafCats(cs))).catch(() => undefined);
    // 供应商下拉：初始加载前 100 个；搜索走服务端（全库），避免供应商多时关联不上
    baseApi.suppliers(1).then((d) => setSuppliers(d.list.map((s) => ({ id: s.id, name: s.name })))).catch(() => undefined);
  }, []);

  /** 供应商服务端搜索（表单关联用，全库匹配）。 */
  function querySuppliers(kw: string) {
    if (supDebounce.current) clearTimeout(supDebounce.current);
    const k = kw.trim();
    if (!k) {
      setSuppliers((old) => old); // 清空搜索时保持当前列表
      return;
    }
    supDebounce.current = setTimeout(() => {
      void baseApi.suppliers(1, k).then((d) => setSuppliers(d.list.map((s) => ({ id: s.id, name: s.name })))).catch(() => undefined);
    }, 300);
  }

  async function runDedupe() {
    setDedupeOpen(true);
    setDedupeLoading(true);
    try {
      const r = await baseApi.dedupeScan();
      setDedupeGroups(r.groups);
      if (!r.groups.length) message.info("未发现疑似重复材料");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查重失败");
    } finally {
      setDedupeLoading(false);
    }
  }

  async function markDuplicate(id: number) {
    try {
      await baseApi.markDuplicate(id);
      message.success("已标记为重复（见备注【疑似重复】）");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "标记失败");
    }
  }

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    form.setFieldsValue({
      name: p.name,
      material_code: p.material_code,
      barcode: p.barcode,
      spec: p.spec,
      unit_id: p.unit_id,
      category_id: p.category_id || undefined,
      purchase_price: Number(p.purchase_price || 0),
      min_stock: Number(p.min_stock || 0),
      max_stock: Number(p.max_stock || 0),
      remark: p.remark,
      supplier_ids: p.supplier_ids ?? [],
    });
    // 已关联供应商不在当前候选列表时也回显名称（避免显示数字 id / 无法取消勾选）
    if (p.supplier_ids?.length) {
      setSuppliers((old) => {
        const have = new Set(old.map((s) => s.id));
        const extra = (p.supplier_ids ?? [])
          .map((id, i) => ({ id, name: p.supplier_names?.[i] ?? "" }))
          .filter((s) => s.id && s.name && !have.has(s.id));
        return extra.length ? [...old, ...extra] : old;
      });
    }
    setOpen(true);
  }

  async function save() {
    const v = await form.validateFields();
    const body: ProductInput = {
      name: v.name,
      material_code: v.material_code ?? "",
      barcode: (v.barcode ?? "").trim(),
      spec: v.spec ?? "",
      unit_id: v.unit_id,
      category_id: v.category_id ?? 0,
      purchase_price: String(v.purchase_price ?? 0),
      min_stock: String(v.min_stock ?? 0),
      max_stock: String(v.max_stock ?? 0),
      remark: v.remark ?? "",
      supplier_ids: v.supplier_ids ?? [],
    };
    try {
      if (editing) {
        await baseApi.updateProduct(editing.id, body);
        message.success("材料已更新");
      } else {
        const p = await baseApi.createProduct(body);
        message.success(`材料已创建：${p.name}`);
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function toggleStatus(p: Product) {
    try {
      await baseApi.updateProduct(p.id, {
        name: p.name,
        unit_id: p.unit_id,
        status: p.status === 1 ? 0 : 1,
      });
      message.success(p.status === 1 ? "已停用" : "已启用");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  /** 拍照识别材料名称：OCR 快查 → 命中系统材料用其名，否则取首行识别文本。 */
  async function ocrName(f: File | undefined) {
    if (!f) return;
    try {
      const up = await fileApi.upload(f, "ocr");
      const data = await ocrApi.quick(up.file_id, 2);
      const name = (data.matches[0]?.name ?? data.lines.find((t) => t.trim()) ?? "").trim();
      if (name) {
        form.setFieldValue("name", name);
        message.success(`已识别名称：${name}`);
      } else {
        message.warning("未识别到文字，请手动输入");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "识别失败");
    }
  }

  /** 拍照扫码：解码条码并填入条码字段（条码可选，未识别到可手输）。 */
  async function scanBarcode(f: File | undefined) {
    if (!f) return;
    try {
      const up = await fileApi.upload(f, "ocr");
      const data = await ocrApi.decodeBarcode(up.file_id);
      form.setFieldValue("barcode", data.barcode);
      message.success(`条码：${data.barcode}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "未识别到条码");
    }
  }

  const columns: ColumnsType<Product> = [
    { title: "物料编码", dataIndex: "material_code", width: 120, render: (v: string) => v || "-" },
    { title: "条码", dataIndex: "barcode", width: 140, render: (v: string) => v || <span style={{ color: "#c0c4cc" }}>未录</span> },
    { title: "材料名称", dataIndex: "name", width: 160 },
    { title: "型号规格", dataIndex: "spec", width: 120, render: (v: string) => v || "-" },
    { title: "单位", dataIndex: "unit_name", width: 70 },
    { title: "分类", dataIndex: "category_name", width: 110, render: (v: string) => v || "-" },
    {
      title: "供应商",
      dataIndex: "supplier_names",
      width: 160,
      render: (v: string[]) => (v?.length ? v.join("、") : <span style={{ color: "#c0c4cc" }}>未关联</span>),
    },
    { title: "价格", dataIndex: "purchase_price", width: 90, align: "right" as const },
    { title: "下限", dataIndex: "min_stock", width: 80, align: "right" as const },
    { title: "上限", dataIndex: "max_stock", width: 80, align: "right" as const },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (v: number) => (v === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 16px" }}>材料管理</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="材料名称 / 编码 / 物料编码 / 规格"
          allowClear
          style={{ width: 260 }}
          onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
        />
        <Input
          placeholder="条码精确查询"
          allowClear
          style={{ width: 180 }}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value.trim())}
          onPressEnter={() => setPage(1)}
        />
        <Button type="primary" onClick={openCreate}>新建材料</Button>
        {aiKeywords.length > 0 && <Tag color="blue">已扩展搜索词：{aiKeywords.join(" / ")}</Tag>}
        <Button loading={dedupeLoading} onClick={() => void runDedupe()}>查重</Button>
      </Space>
      <DataTable
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        locale={{ emptyText: "暂无材料" }}
        pagination={{ current: page, pageSize, total, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
        rowSelection
        onBatchDelete={async (keys) => {
          for (const k of keys) await baseApi.deleteProduct(Number(k));
          message.success(`已停用 ${keys.length} 个材料`);
          void load();
        }}
        actionsWidth={140}
        actions={(r) => (
          <Space>
            <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
            <Popconfirm title={r.status === 1 ? "确认停用该材料？" : "确认启用该材料？"} onConfirm={() => void toggleStatus(r)}>
              <Button size="small" danger={r.status === 1}>{r.status === 1 ? "停用" : "启用"}</Button>
            </Popconfirm>
          </Space>
        )}
      />

      <Modal
        title={editing ? `编辑材料：${editing.name}` : "新建材料"}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        width={560}
        forceRender
      >
        {/* 相机/相册输入：材料名称 OCR / 条码解码（相册 input 不带 capture，移动端浏览器访问时可选图） */}
        <input
          ref={nameFileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            void ocrName(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={nameAlbumRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            void ocrName(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={barcodeFileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            void scanBarcode(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={barcodeAlbumRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            void scanBarcode(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Form form={form} layout="vertical">
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="name" label="材料名称" rules={[{ required: true, message: "请输入材料名称" }]} style={{ width: 320 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Input placeholder="如：轴承6204" maxLength={100} value={nameValue} onChange={(e) => form.setFieldValue("name", e.target.value)} />
                <Button icon={<CameraOutlined style={{ color: "#5B7FFF" }} />} title="拍照识别名称" onClick={() => nameFileRef.current?.click()} />
                <Button icon={<PictureOutlined style={{ color: "#5B7FFF" }} />} title="相册选图识别名称" onClick={() => nameAlbumRef.current?.click()} />
              </Space.Compact>
            </Form.Item>
            <Form.Item name="unit_id" label="基本单位" rules={[{ required: true, message: "请选择单位" }]} style={{ width: 120 }}>
              <Select placeholder="选择" options={units} fieldNames={{ label: "name", value: "id" }} />
            </Form.Item>
            <Form.Item name="barcode" label="条码（可选，扫码录入用）" style={{ width: 280 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Input placeholder="扫码枪/手输，或拍照扫码" maxLength={50} value={barcodeValue} onChange={(e) => form.setFieldValue("barcode", e.target.value)} />
                <Button icon={<CameraOutlined style={{ color: "#5B7FFF" }} />} title="拍照识别条码" onClick={() => barcodeFileRef.current?.click()} />
                <Button icon={<PictureOutlined style={{ color: "#5B7FFF" }} />} title="相册选图识别条码" onClick={() => barcodeAlbumRef.current?.click()} />
              </Space.Compact>
            </Form.Item>
            <Form.Item name="material_code" label="物料编码（公司系统编码，可选）" style={{ width: 240 }}>
              <Input placeholder="留空则提示管理员补录" maxLength={50} />
            </Form.Item>
            <Form.Item name="spec" label="型号规格" style={{ width: 200 }}>
              <Input placeholder="如：20x12" maxLength={100} />
            </Form.Item>
            <Form.Item name="category_id" label="分类" style={{ width: 200 }}>
              <Select
                placeholder="选择"
                allowClear
                options={categoryValue && !cats.some((c) => c.id === categoryValue) ? [{ id: categoryValue, name: "原分类（顶级，请改挂二级/三级）" }, ...cats] : cats}
                fieldNames={{ label: "name", value: "id" }}
              />
            </Form.Item>
            <Form.Item name="supplier_ids" label="关联供应商（可多选）" style={{ width: 280 }}>
              <Select
                mode="multiple"
                placeholder="输入名称搜索 / 选择"
                allowClear
                showSearch
                filterOption={false}
                onSearch={querySuppliers}
                options={suppliers}
                fieldNames={{ label: "name", value: "id" }}
                maxTagCount={2}
              />
            </Form.Item>
            <Form.Item name="purchase_price" label="价格" style={{ width: 120 }}>
              <InputNumber min={0} precision={2} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="min_stock" label="库存下限" style={{ width: 120 }}>
              <InputNumber min={0} precision={3} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="max_stock" label="库存上限" style={{ width: 120 }}>
              <InputNumber min={0} precision={3} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="remark" label="备注" style={{ width: 520 }}>
              <Input maxLength={255} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* 材料查重结果（P9-P1②）：AI 建议分组，人工确认后标记 */ }
      <Drawer
        title="材料查重建议（仅供参考）"
        open={dedupeOpen}
        onClose={() => setDedupeOpen(false)}
        size={680}
      >
        {dedupeGroups.length === 0 && !dedupeLoading && <Typography.Text type="secondary">未发现疑似重复材料</Typography.Text>}
        {dedupeGroups.map((g, gi) => (
          <div key={gi} style={{ border: "1px solid #E4EAF6", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Tag color={g.confidence === "high" ? "red" : "orange"}>{g.confidence === "high" ? "高置信" : "AI 判断"}</Tag>
              <Typography.Text>{g.reason}</Typography.Text>
            </div>
            {g.group.map((m) => (
              <div key={m.product_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px dashed #f0f0f0" }}>
                <span>
                  <b>{m.name}</b>
                  {m.spec ? `（${m.spec}）` : ""}
                  <span style={{ color: "#5B6478", fontSize: 12, marginLeft: 8 }}>
                    {m.material_code ? `编码 ${m.material_code}` : "无物料编码"} · {m.unit_name || "-"}
                  </span>
                </span>
                <Button size="small" onClick={() => void markDuplicate(m.product_id)}>标记重复</Button>
              </div>
            ))}
          </div>
        ))}
      </Drawer>
    </div>
  );
}
