import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Divider, Form, Input, InputNumber, Modal, Popconfirm, Select, Space } from "antd";
import { EditOutlined, PlusOutlined, RobotOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { aiApi, baseApi, type AiSuggestion, type CategoryNode } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

/** 分类树拍平（保留完整节点，parent_id 用于上级查询）。 */
function flattenCats(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) out.push(...flattenCats(n.children));
  }
  return out;
}

/** 分类树转父分类候选（新增/编辑分类弹窗用：顶级 + 一级 + 二级，三级下不能再建）。 */
function catOptions(nodes: CategoryNode[]): { value: number; label: string }[] {
  const out = [{ value: 0, label: "顶级分类" }];
  for (const n of nodes) {
    out.push({ value: n.id, label: n.name });
    n.children?.forEach((c) => out.push({ value: c.id, label: `${n.name}/${c.name}` }));
  }
  return out;
}

/** AI 建议处理（电脑端）：未匹配商品 → 视觉识别建议 → 人工确认新增/忽略。 */
export function AiSuggestionsPage() {
  const { message } = App.useApp();
  const [list, setList] = useState<AiSuggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [accepting, setAccepting] = useState<AiSuggestion | null>(null);
  const [units, setUnits] = useState<{ id: number; name: string }[]>([]);
  const [catTree, setCatTree] = useState<CategoryNode[]>([]);
  const [form, setForm] = useState({ code: "", name: "", category_id: 0, unit_id: 0, purchase_price: "0" });
  // 分类内联维护（确认新增材料弹窗内新增/编辑分类）
  const [catSelOpen, setCatSelOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [catIsEdit, setCatIsEdit] = useState(false);
  const [catTarget, setCatTarget] = useState<CategoryNode | null>(null);
  const [catForm] = Form.useForm();

  const catFlat = useMemo(() => flattenCats(catTree), [catTree]);
  const catSelOptions = useMemo(() => catOptions(catTree), [catTree]);
  // 材料挂载候选（三级体系）：二级 + 三级分类，显示完整路径；编辑目标候选：全部节点
  const catLeaf = useMemo(() => {
    const out: { id: number; name: string }[] = [];
    for (const n of catTree) {
      n.children?.forEach((c) => {
        out.push({ id: c.id, name: `${n.name}/${c.name}` });
        c.children?.forEach((g) => out.push({ id: g.id, name: `${n.name}/${c.name}/${g.name}` }));
      });
    }
    return out;
  }, [catTree]);
  const catEditOptions = useMemo(
    () => [
      ...catSelOptions.filter((o) => o.value !== 0),
      ...catTree.flatMap((n) =>
        (n.children ?? []).flatMap((c) => [
          { value: c.id, label: `${n.name}/${c.name}` },
          ...(c.children ?? []).map((g) => ({ value: g.id, label: `${n.name}/${c.name}/${g.name}` })),
        ])
      ),
    ],
    [catSelOptions, catTree]
  );

  const load = useCallback(async () => {
    setList([]); // 清空旧数据，避免切换每页条数时 dataSource 与分页配置不匹配
    try {
      const data = await aiApi.list(1, page, pageSize);
      setList(data.list);
      setTotal(data.total);
    } catch {
      // 加载失败保持空列表（错误已由 request 层转为可读 BizError），避免 unhandled rejection
      setList([]);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 拉取分类树；selectId 存在时自动选中（新增分类后直接用于当前材料）。 */
  const reloadCats = useCallback(async (selectId?: number) => {
    try {
      setCatTree(await baseApi.categories());
      if (selectId) setForm((f) => ({ ...f, category_id: selectId }));
    } catch {
      // 分类加载失败不阻塞确认新增（错误已由 request 层转为 BizError）
    }
  }, []);

  useEffect(() => {
    baseApi.units().then((u) => setUnits(u)).catch(() => undefined);
    void reloadCats();
  }, [reloadCats]);

  function openAccept(sug: AiSuggestion) {
    setAccepting(sug);
    setForm({ code: "", name: sug.product_name, category_id: 0, unit_id: units[0]?.id ?? 0, purchase_price: "0" });
  }

  async function doAccept() {
    if (!accepting) return;
    try {
      await aiApi.accept(accepting.id, {
        code: form.code,
        name: form.name,
        category_id: form.category_id || undefined,
        unit_id: form.unit_id || undefined,
        purchase_price: form.purchase_price,
      });
      message.success("已新增材料");
      setAccepting(null);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "新增失败");
    }
  }

  function openCatCreate() {
    setCatIsEdit(false);
    setCatTarget(null);
    setCatSelOpen(false);
    setCatOpen(true);
  }

  function openCatEdit() {
    // 缺省编辑当前选中的分类；未选择时从已有分类中挑第一个
    setCatIsEdit(true);
    setCatTarget(catFlat.find((c) => c.id === form.category_id) ?? catFlat[0] ?? null);
    setCatSelOpen(false);
    setCatOpen(true);
  }

  async function saveCat() {
    if (catIsEdit && !catTarget) {
      message.error("暂无可编辑的分类，请先新增分类");
      return;
    }
    const v = await catForm.validateFields();
    const body = { parent_id: v.parent_id ?? 0, name: v.name.trim(), sort: v.sort ?? 0 };
    try {
      if (catIsEdit && catTarget) {
        await baseApi.updateCategory(catTarget.id, body);
        message.success("分类已更新");
        await reloadCats(form.category_id || undefined);
      } else {
        const created = await baseApi.createCategory(body);
        // 规则：材料只能挂二级分类；新建的顶级分类不自动选中，需先建其子分类
        message.success(created.parent_id !== 0 ? "分类已创建" : "分类已创建（顶级分类仅作分组，请再创建其子分类后挂材料）");
        await reloadCats(created.parent_id !== 0 ? created.id : 0);
      }
      setCatOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  const columns: ColumnsType<AiSuggestion> = [
    { title: "AI 建议材料名", dataIndex: "product_name", width: 220 },
    { title: "规格", render: (_, r) => r.suggestion?.spec ?? "-" },
    { title: "类别", render: (_, r) => r.suggestion?.category ?? "-" },
    { title: "备注", render: (_, r) => r.suggestion?.note ?? "-" },
    { title: "模型", dataIndex: "model", width: 120 },
    { title: "时间", dataIndex: "created_at", width: 160 },
    {
      title: "操作",
      width: 150,
      render: (_, r) => (
        <Space>
          <Button size="small" type="primary" onClick={() => openAccept(r)}>
            确认新增
          </Button>
          <Popconfirm title="确认忽略该建议？" onConfirm={async () => { try { await aiApi.ignore(r.id); message.success("已忽略"); void load(); } catch (e) { message.error(e instanceof Error ? e.message : "失败"); } }}>
            <Button size="small" danger>忽略</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头：图标 + 标题 + 说明，右侧待确认数 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 280, flex: 1 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "#5B7FFF", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>
            <RobotOutlined />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>AI 建议处理</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "#5B6478" }}>
              拍照识别中未匹配到系统资料的材料，由视觉识别后生成建议；
              <strong style={{ color: "#1E2433", fontWeight: 600 }}>人工确认后才新增材料</strong>
              （可在系统设置配置模型配置）。
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", borderRadius: 999, background: "#eef4ff", border: "1px solid #D9E3FF", flexShrink: 0 }}>
          <RobotOutlined style={{ color: "#5B7FFF", fontSize: 15 }} />
          <span style={{ fontSize: 13, color: "#3d5a8f", fontWeight: 500 }}>待确认</span>
          <strong style={{ fontSize: 18, color: "#0958d9", lineHeight: 1 }}>{total}</strong>
          <span style={{ fontSize: 13, color: "#3d5a8f" }}>条</span>
        </div>
      </div>

      {/* 建议列表卡片：头部条 + 表格 */}
      <div style={{ background: "#fff", border: "1px solid #e9edf2", borderRadius: 12, boxShadow: "0 1px 3px rgba(16,24,40,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px", background: "#f8fafc", borderBottom: "1px solid #eef1f5", borderRadius: "12px 12px 0 0" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1f2733" }}>待处理建议</span>
          <span style={{ fontSize: 12, color: "#8a94a6" }}>勾选可批量忽略</span>
        </div>
        <div style={{ padding: "12px 20px 4px" }}>
        <DataTable
          rowKey="id"
          columns={columns}
          dataSource={list}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`, onChange: (p: number, ps: number) => { if (ps !== pageSize) { setPage(1); setPageSize(ps); } else { setPage(p); } } }}
          rowSelection
          locale={{ emptyText: "暂无待处理建议" }}
          onBatchDelete={async (keys) => { for (const k of keys) await aiApi.ignore(Number(k)); message.success(`已忽略 ${keys.length} 条建议`); void load(); }}
        />
        </div>
      </div>

      {/* 确认新增材料 */}
      <Modal
        title={<Space size={8}><RobotOutlined style={{ color: "#5B7FFF" }} />确认新增材料</Space>}
        open={Boolean(accepting)}
        onOk={() => void doAccept()}
        okText="确认新增"
        onCancel={() => setAccepting(null)}
        width={600}
        centered
      >
        <Alert type="info" showIcon title="将按以下信息新增到材料库，编码自动生成；确认后该建议标记为已处理。" style={{ marginBottom: 16 }} />
        <Form layout="vertical">
          <Form.Item label="材料名称" required style={{ marginBottom: 16 }}>
            <Input placeholder="缺省用 AI 建议名" maxLength={100} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.8fr", gap: 12 }}>
            <Form.Item label="分类" style={{ marginBottom: 0 }} extra="二级/三级分类可挂材料；下拉底部可新增 / 编辑分类">
              <Select
                placeholder="选择分类"
                options={form.category_id && !catLeaf.some((o) => o.id === form.category_id) ? [{ id: form.category_id, name: "原分类（顶级，请改挂二级/三级）" }, ...catLeaf] : catLeaf}
                fieldNames={{ label: "name", value: "id" }}
                value={form.category_id || undefined}
                onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
                allowClear
                open={catSelOpen}
                onDropdownVisibleChange={(o) => setCatSelOpen(o)}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: "8px 0" }} />
                    <Space style={{ padding: "0 8px 8px" }}>
                      <Button type="link" size="small" icon={<PlusOutlined />} onClick={openCatCreate}>新增分类</Button>
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={openCatEdit}>编辑分类</Button>
                    </Space>
                  </>
                )}
              />
            </Form.Item>
            <Form.Item label="单位" style={{ marginBottom: 0 }}>
              <Select style={{ width: "100%" }} placeholder="选择单位" options={units} fieldNames={{ label: "name", value: "id" }} value={form.unit_id || undefined} onChange={(v) => setForm((f) => ({ ...f, unit_id: v }))} />
            </Form.Item>
            <Form.Item label="价格（元）" style={{ marginBottom: 0 }}>
              <InputNumber style={{ width: "100%" }} placeholder="0.00" min={0} precision={2} value={Number(form.purchase_price)} onChange={(v) => setForm((f) => ({ ...f, purchase_price: String(v ?? 0) }))} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* 分类新增/编辑 */}
      <Modal
        title={catIsEdit ? `编辑分类：${catTarget?.name ?? ""}` : "新增分类"}
        open={catOpen}
        onOk={() => void saveCat()}
        okText="保存"
        onCancel={() => setCatOpen(false)}
        width={420}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (!o) return;
          if (catIsEdit && catTarget) {
            catForm.setFieldsValue({ name: catTarget.name, parent_id: catTarget.parent_id, sort: catTarget.sort ?? 0 });
          } else {
            catForm.resetFields();
            catForm.setFieldsValue({ parent_id: 0, sort: 0 });
          }
        }}
      >
        <Form form={catForm} layout="vertical">
          {catIsEdit && (
            <Form.Item label="选择分类" required>
              <Select
                placeholder="选择要编辑的分类"
                options={catEditOptions}
                value={catTarget?.id}
                onChange={(id) => {
                  const c = catFlat.find((x) => x.id === id);
                  if (!c) return;
                  setCatTarget(c);
                  catForm.setFieldsValue({ name: c.name, parent_id: c.parent_id, sort: c.sort ?? 0 });
                }}
              />
            </Form.Item>
          )}
          <Form.Item name="name" label="分类名称" rules={[{ required: true, message: "请输入分类名称" }, { max: 50, message: "不超过 50 字" }]}>
            <Input placeholder="如：轴承类 / 五金件" maxLength={50} />
          </Form.Item>
          <Form.Item name="parent_id" label="父分类" rules={[{ required: true, message: "请选择父分类" }]}>
            <Select options={catIsEdit && catTarget ? catSelOptions.filter((o) => o.value !== catTarget.id) : catSelOptions} />
          </Form.Item>
          <Form.Item name="sort" label="排序（小在前）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}