import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
  TagsOutlined,
} from "@ant-design/icons";

import { baseApi, type CategoryNode, type Product } from "@wlt/shared";

/** 分类树拍平（三级：顶级 / 二级 / 三级）。 */
function flattenCats(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) out.push(...flattenCats(n.children));
  }
  return out;
}

/** 按关键词过滤分类树：命中自身保留完整子树，命中子孙保留命中项及祖先链。 */
function filterTree(nodes: CategoryNode[], kw: string): CategoryNode[] {
  const k = kw.trim().toLowerCase();
  if (!k) return nodes;
  const out: CategoryNode[] = [];
  for (const n of nodes) {
    const self = n.name.toLowerCase().includes(k);
    const kids = n.children ? filterTree(n.children, k) : [];
    if (self) out.push({ ...n, children: n.children });
    else if (kids.length) out.push({ ...n, children: kids });
  }
  return out;
}

/** 子树材料合计（含自身与全部子孙）。 */
function subtreeMats(n: CategoryNode): number {
  return (n.product_count ?? 0) + (n.children ?? []).reduce((s, c) => s + subtreeMats(c), 0);
}

interface TreeItem {
  key: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  children?: TreeItem[];
}

const MAT_PAGE_SIZE = 10;

/** 分类管理（电脑端，base:category）：三级分类树形页面 —— 左侧分类树导航，右侧选中分类详情；
 *  二级/三级分类展示「挂载材料」表格（可取消挂载），顶级分类仅作分组不展示挂载区。 */
export function CategoriesPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [list, setList] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [kw, setKw] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryNode | null>(null);
  const [parentPreset, setParentPreset] = useState(0);
  const [form] = Form.useForm();
  // 挂载材料表格（仅二级/三级分类）
  const [mats, setMats] = useState<Product[]>([]);
  const [matTotal, setMatTotal] = useState(0);
  const [matPage, setMatPage] = useState(1);
  const [matLoading, setMatLoading] = useState(false);
  const [detaching, setDetaching] = useState<number | undefined>(undefined);
  // 移动材料：选择目标分类（二级/三级，不含当前分类）
  const [moveTarget, setMoveTarget] = useState<Product | null>(null);
  const [moveCatId, setMoveCatId] = useState<number | undefined>(undefined);
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setList(await baseApi.categories());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flat = useMemo(() => flattenCats(list), [list]);
  const byId = useMemo(() => new Map(flat.map((n) => [n.id, n])), [flat]);
  const sel = selectedId != null ? (byId.get(selectedId) ?? null) : null;

  /** 分类层级：1=顶级、2=二级、3=三级。 */
  function catDepth(id: number): number {
    const n = byId.get(id);
    if (!n) return 0;
    if (n.parent_id === 0) return 1;
    const p = byId.get(n.parent_id);
    return p && p.parent_id === 0 ? 2 : 3;
  }

  // 选中节点被删除后回退为空选（回到"请选择"引导态）
  useEffect(() => {
    if (selectedId != null && !byId.has(selectedId)) setSelectedId(null);
  }, [byId, selectedId]);

  // 选中二级/三级分类 → 拉取挂载材料（分页；顶级分类不展示挂载区）
  useEffect(() => {
    const target = selectedId != null ? byId.get(selectedId) : undefined;
    if (!target || target.parent_id === 0) {
      setMats([]);
      setMatTotal(0);
      return;
    }
    let alive = true;
    setMatLoading(true);
    baseApi
      .products("", matPage, { categoryId: target.id, pageSize: MAT_PAGE_SIZE })
      .then((d) => {
        if (!alive) return;
        setMats(d.list);
        setMatTotal(d.total);
      })
      .catch(() => {
        if (alive) {
          setMats([]);
          setMatTotal(0);
        }
      })
      .finally(() => {
        if (alive) setMatLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedId, byId, matPage]);

  // 选中变化时回到第 1 页
  useEffect(() => {
    setMatPage(1);
  }, [selectedId]);

  const filtered = useMemo(() => filterTree(list, kw), [list, kw]);

  // 受控展开：过滤后仍展开所有含子分类的节点（搜索命中时自动展开对应路径）
  const expandedKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (ns: CategoryNode[]) => {
      for (const n of ns) {
        if (n.children?.length) {
          keys.push(String(n.id));
          walk(n.children);
        }
      }
    };
    walk(filtered);
    return keys;
  }, [filtered]);

  function buildTreeItems(nodes: CategoryNode[], level: number): TreeItem[] {
    return nodes.map((n) => {
      const agg = level === 0 ? subtreeMats(n) : (n.product_count ?? 0);
      return {
        key: String(n.id),
        icon:
          level === 0 ? (
            <FolderOpenOutlined style={{ color: token.colorPrimary }} />
          ) : (
            <TagsOutlined style={{ color: level === 1 ? "#3c89f0" : token.colorTextTertiary }} />
          ),
        title: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span>{n.name}</span>
            {n.children?.length ? (
              <Tag style={{ fontSize: 11, lineHeight: "16px", marginInlineEnd: 0 }}>{n.children.length} 子类</Tag>
            ) : null}
            {agg > 0 ? (
              <Tag color="blue" style={{ fontSize: 11, lineHeight: "16px", marginInlineEnd: 0 }}>{agg} 种</Tag>
            ) : null}
          </span>
        ),
        children: n.children?.length ? buildTreeItems(n.children, level + 1) : undefined,
      };
    });
  }

  const treeData = useMemo<TreeItem[]>(() => buildTreeItems(filtered, 0), [filtered, token]);

  // 父分类候选（新建/编辑弹窗）：顶级 + 一级 + 二级（三级下不能再建，保持三级体系）
  const parentOptions = useMemo(() => {
    const out = [{ value: 0, label: "顶级分类" }];
    for (const n of list) {
      out.push({ value: n.id, label: n.name });
      n.children?.forEach((c) => out.push({ value: c.id, label: `${n.name}/${c.name}` }));
    }
    return out;
  }, [list]);

  function openCreate(parentId: number) {
    setEditing(null);
    setParentPreset(parentId);
    setOpen(true);
  }

  function openEdit(c: CategoryNode) {
    setEditing(c);
    setParentPreset(c.parent_id);
    setOpen(true);
  }

  async function save() {
    const v = await form.validateFields();
    const body = { parent_id: v.parent_id ?? 0, name: v.name.trim(), sort: v.sort ?? 0 };
    try {
      if (editing) {
        await baseApi.updateCategory(editing.id, body);
        message.success("分类已更新");
      } else {
        await baseApi.createCategory(body);
        message.success("分类已创建");
      }
      setOpen(false);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function remove(c: CategoryNode) {
    try {
      await baseApi.deleteCategory(c.id);
      message.success("分类已删除");
      if (selectedId === c.id) setSelectedId(null);
      void load();
    } catch (e) {
      // 404=分类不存在（可能已被他人/其他端删除），409=存在子分类或挂载材料
      message.error(`删除失败：${e instanceof Error ? e.message : "未知错误"}`);
      void load(); // 刷新树，避免前端残留已删除节点
    }
  }

  async function detach(p: Product) {
    setDetaching(p.id);
    try {
      await baseApi.updateProductCategory(p.id, 0);
      message.success(`已将「${p.name}」取消挂载`);
      if (mats.length === 1 && matPage > 1) setMatPage(matPage - 1);
      void load(); // 刷新树上的材料数徽标（product_count 实时统计）
    } catch (e) {
      message.error(e instanceof Error ? e.message : "取消挂载失败");
    } finally {
      setDetaching(undefined);
    }
  }

  /** 移动材料到其他二级/三级分类（排除当前分类）。 */
  const moveOptions = useMemo(() => {
    if (!sel) return [];
    const out: { value: number; label: string }[] = [];
    for (const n of list) {
      n.children?.forEach((c) => {
        if (c.id !== sel.id) out.push({ value: c.id, label: `${n.name}/${c.name}` });
        c.children?.forEach((g) => {
          if (g.id !== sel.id) out.push({ value: g.id, label: `${n.name}/${c.name}/${g.name}` });
        });
      });
    }
    return out;
  }, [list, sel]);

  async function doMove() {
    if (!moveTarget) return;
    if (moveCatId === undefined) {
      message.warning("请选择目标分类");
      return;
    }
    setMoving(true);
    try {
      await baseApi.updateProductCategory(moveTarget.id, moveCatId);
      message.success(`已将「${moveTarget.name}」移动到新分类`);
      setMoveTarget(null);
      if (mats.length === 1 && matPage > 1) setMatPage(matPage - 1);
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "移动失败");
    } finally {
      setMoving(false);
    }
  }

  // 选中分类层级与"新建子分类"可用性：
  // 1) 三级分类不能再建子分类；2) 二级分类已挂材料时不能再建子分类（挂材料与建子分类二选一）
  const selDepth = sel ? catDepth(sel.id) : 0;
  const childBlocked = sel ? selDepth >= 3 || (selDepth === 2 && (sel.product_count ?? 0) > 0) : false;

  const matColumns: ColumnsType<Product> = [
    { title: "材料名称", dataIndex: "name", render: (v: string) => <b>{v}</b> },
    { title: "物料编码", dataIndex: "material_code", width: 140, render: (v: string) => v || "-" },
    { title: "条形码", dataIndex: "barcode", width: 140, render: (v: string) => v || "-" },
    { title: "规格型号", dataIndex: "spec", width: 130, render: (v: string) => v || "-" },
    { title: "数量", dataIndex: "stock_qty", width: 90, align: "right" as const, render: (v?: string) => (v === undefined ? "0" : v) },
    { title: "单位", dataIndex: "unit_name", width: 70, render: (v: string) => v || "-" },
    { title: "进价", dataIndex: "purchase_price", width: 100, align: "right" as const, render: (v: string) => `¥ ${v}` },
    { title: "添加时间", dataIndex: "created_at", width: 150, render: (v?: string) => (v ? v.slice(0, 16) : "-") },
    {
      title: "操作",
      width: 140,
      render: (_, p) => (
        <Space size={4}>
          <Tooltip title="移动材料">
            <Button type="text" size="small" icon={<SwapOutlined />} style={{ color: token.colorPrimary }} onClick={() => setMoveTarget(p)} />
          </Tooltip>
          <Popconfirm
            title={`确认将「${p.name}」从该分类取消挂载？`}
            description="取消后材料变为未分类，可在材料管理中重新挂载"
            onConfirm={() => void detach(p)}
          >
            <Tooltip title="取消挂载">
              <Button type="text" size="small" danger icon={<DisconnectOutlined />} loading={detaching === p.id} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页头：标题 + 说明（左），刷新 / 新建（右） */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>分类管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            三级分类树：顶级分类仅作分组，材料挂到二级/三级分类；有子分类或已挂材料的分类不可删除
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(0)}>新建分类</Button>
        </Space>
      </div>

      {err && (
        <Alert
          type="error"
          showIcon
          title="分类数据加载失败"
          description={err}
          action={<Button size="small" danger onClick={() => void load()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 树形主从布局：左侧分类树（导航）+ 右侧详情面板 */}
      <div
        className="wlt-cat-layout"
        style={{
          display: "flex",
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
          minHeight: 480,
          overflow: "hidden",
        }}
      >
        {/* 左：分类树 */}
        <aside
          className="wlt-cat-aside"
          style={{
            width: 300,
            flexShrink: 0,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            background: "#F8FAFF",
            padding: 12,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="搜索分类名称"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          {loading && !list.length ? (
            <Skeleton active paragraph={{ rows: 6 }} title={false} style={{ padding: "4px 8px" }} />
          ) : treeData.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={kw ? "未找到匹配的分类" : "还没有分类"} style={{ margin: 0 }}>
                {!kw && (
                  <Button size="small" type="primary" ghost onClick={() => openCreate(0)}>
                    新建第一个分类
                  </Button>
                )}
              </Empty>
            </div>
          ) : (
            <Tree
              blockNode
              showIcon
              treeData={treeData}
              expandedKeys={expandedKeys}
              selectedKeys={selectedId != null ? [String(selectedId)] : []}
              onSelect={(keys) => {
                const k = keys[0];
                setSelectedId(k ? Number(k) : null);
              }}
              style={{ flex: 1, overflow: "auto", background: "transparent" }}
            />
          )}
          <div style={{ paddingTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}`, fontSize: 12, color: token.colorTextSecondary }}>
            共 {flat.length} 个分类 · 三级结构
          </div>
        </aside>

        {/* 右：选中分类详情 */}
        <main style={{ flex: 1, minWidth: 0, padding: 20 }}>
          {loading && !list.length ? (
            <Skeleton active paragraph={{ rows: 5 }} />
          ) : !sel ? (
            <div style={{ height: "100%", minHeight: 380, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={flat.length ? "在左侧分类树中选择一个分类，查看详情与挂载材料" : "还没有分类，先创建一个顶级分类"}
              >
                <Button type="primary" ghost onClick={() => openCreate(0)}>
                  新建分类
                </Button>
              </Empty>
            </div>
          ) : (
            <>
              {/* 详情头：名称 + 层级标签 + 元信息（左），操作（右） */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{sel.name}</span>
                    {sel.parent_id === 0 ? <Tag color="blue">顶级分类</Tag> : <Tag>{byId.get(sel.parent_id)?.name ?? "-"}</Tag>}
                    {sel.children?.length ? <Tag>{sel.children.length} 个子分类</Tag> : null}
                    {sel.parent_id !== 0 ? <Tag color="blue">{sel.product_count ?? 0} 种材料</Tag> : null}
                  </div>
                  <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>
                    排序 {sel.sort ?? 0} · {sel.parent_id === 0 ? "顶级分类仅作分组，不挂材料" : "材料挂载明细见下方表格"}
                  </div>
                </div>
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(sel)}>
                    编辑
                  </Button>
                  <Tooltip
                    title={
                      selDepth >= 3
                        ? "分类最多三级，三级分类下不能再建子分类"
                        : childBlocked
                          ? "该分类已挂载材料，不能再创建子分类"
                          : ""
                    }
                  >
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<PlusOutlined />}
                      disabled={childBlocked}
                      onClick={() => openCreate(sel.id)}
                    >
                      新建子分类
                    </Button>
                  </Tooltip>
                  <Popconfirm
                    title={`确认删除分类「${sel.name}」？`}
                    description="有子分类或已挂材料的分类会被系统拒绝删除"
                    onConfirm={() => void remove(sel)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>

              {/* 子分类宫格（含"新建子分类"虚线砖块；三级分类不再展示） */}
              {sel.children?.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
                  {sel.children.map((c) => (
                    <div
                      key={c.id}
                      className={"wlt-cat-cell" + (selectedId === c.id ? " wlt-cat-cell-active" : "")}
                      onClick={() => setSelectedId(c.id)}
                      style={{
                        background: token.colorBgContainer,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: 8,
                        padding: "12px 14px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <TagsOutlined style={{ color: token.colorPrimary, flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                        </span>
                        <Space size={4} onClick={(e) => e.stopPropagation()}>
                          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(c)} />
                          <Popconfirm title={`确认删除分类「${c.name}」？`} onConfirm={() => void remove(c)}>
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      </div>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 6 }}>
                        排序 {c.sort ?? 0} · {c.product_count ?? 0} 种材料{c.children?.length ? ` · ${c.children.length} 子类` : ""}
                      </div>
                    </div>
                  ))}
                  {!childBlocked && (
                    <button
                      className="wlt-cat-add"
                      onClick={() => openCreate(sel.id)}
                      style={{
                        border: `1px dashed ${token.colorBorder}`,
                        borderRadius: 8,
                        background: "transparent",
                        padding: "12px 14px",
                        cursor: "pointer",
                        fontSize: 13,
                        color: token.colorTextSecondary,
                        minHeight: 74,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <PlusOutlined /> 新建子分类
                    </button>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    border: `1px dashed ${token.colorBorder}`,
                    borderRadius: 8,
                    padding: "24px 20px",
                    textAlign: "center",
                    color: token.colorTextTertiary,
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  暂无子分类
                  {childBlocked && selDepth === 2 ? (
                    <div style={{ fontSize: 12, marginTop: 6 }}>该分类已挂载材料，不能再创建子分类</div>
                  ) : null}
                </div>
              )}

              {/* 挂载材料表格：仅二级/三级分类展示；顶级分类不展示挂载区 */}
              {sel.parent_id !== 0 && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>挂载材料（{sel.product_count ?? 0} 种）</span>
                    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>材料在入库或编辑时选择该分类归档 · 数量为全仓库存合计</span>
                  </div>
                  <Table<Product>
                    rowKey="id"
                    size="small"
                    columns={matColumns}
                    dataSource={mats}
                    loading={matLoading}
                    locale={{ emptyText: "暂无挂载材料" }}
                    pagination={{
                      current: matPage,
                      pageSize: MAT_PAGE_SIZE,
                      total: matTotal,
                      showSizeChanger: false,
                      showTotal: (t) => `共 ${t} 种材料`,
                      onChange: (p) => setMatPage(p),
                    }}
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* 新建 / 编辑分类 */}
      <Modal
        title={editing ? `编辑分类：${editing.name}` : parentPreset !== 0 ? `新建子分类：${byId.get(parentPreset)?.name ?? ""}` : "新建分类"}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        width={420}
        destroyOnHidden forceRender
        afterOpenChange={(o) => {
          if (!o) return;
          if (editing) {
            form.setFieldsValue({ parent_id: editing.parent_id, name: editing.name, sort: editing.sort ?? 0 });
          } else {
            form.resetFields();
            form.setFieldsValue({ parent_id: parentPreset, sort: 0 });
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="parent_id" label="父分类" rules={[{ required: true, message: "请选择父分类" }]} extra="可挂到顶级、二级分类下；三级分类下不能再建子分类，已挂材料的二级分类也不能再建子分类">
            <Select options={parentOptions} />
          </Form.Item>
          <Form.Item name="name" label="分类名称" rules={[{ required: true, message: "请输入分类名称" }, { max: 50, message: "不超过 50 字" }]}>
            <Input placeholder="如：轴承类 / 五金件" maxLength={50} />
          </Form.Item>
          <Form.Item name="sort" label="排序（小在前）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 移动材料：改挂到其他二级/三级分类 */}
      <Modal
        title={`移动材料：${moveTarget?.name ?? ""}`}
        open={Boolean(moveTarget)}
        onOk={() => void doMove()}
        okText="移动"
        confirmLoading={moving}
        onCancel={() => setMoveTarget(null)}
        width={420}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (o) setMoveCatId(undefined);
        }}
      >
        <div style={{ fontSize: 13, color: token.colorTextSecondary, marginBottom: 8 }}>
          当前分类：{sel?.name ?? "-"} · 目标分类可选二级/三级（不含当前分类）
        </div>
        <Select
          style={{ width: "100%" }}
          placeholder="选择目标分类"
          showSearch
          optionFilterProp="label"
          value={moveCatId}
          options={moveOptions}
          onChange={(v) => setMoveCatId(v)}
        />
      </Modal>
    </div>
  );
}
