import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Tree,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  AppstoreOutlined,
  AuditOutlined,
  CameraOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
  TagsOutlined,
} from "@ant-design/icons";

import { baseApi, fileApi, ocrApi, useAuthStore, type CategoryNode, type Product, type ProductInput } from "@wlt/shared";

import { DataTable } from "../components/DataTable";

// ============================ 工具 ============================

/** 分类树拍平（三级：顶级 / 二级 / 三级）。 */
function flattenCats(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) out.push(...flattenCats(n.children));
  }
  return out;
}

/** 子树材料合计（含自身与全部子孙，顶级分类聚合用）。 */
function subtreeMats(n: CategoryNode): number {
  return (n.product_count ?? 0) + (n.children ?? []).reduce((s, c) => s + subtreeMats(c), 0);
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

/** 材料挂载分类候选（二级 + 三级，显示完整路径）+ 未分类。 */
function leafCats(nodes: CategoryNode[]): { id: number; name: string }[] {
  const out: { id: number; name: string }[] = [{ id: 0, name: "未分类" }];
  for (const n of nodes) {
    n.children?.forEach((c) => {
      out.push({ id: c.id, name: `${n.name}/${c.name}` });
      c.children?.forEach((g) => out.push({ id: g.id, name: `${n.name}/${c.name}/${g.name}` }));
    });
  }
  return out;
}

/** 分类层级：1=顶级、2=二级、3=三级。 */
function catDepth(id: number, byId: Map<number, CategoryNode>): number {
  const n = byId.get(id);
  if (!n) return 0;
  if (n.parent_id === 0) return 1;
  const p = byId.get(n.parent_id);
  return p && p.parent_id === 0 ? 2 : 3;
}

interface TreeItem {
  key: string;
  title: React.ReactNode;
  icon?: React.ReactNode;
  children?: TreeItem[];
}

const MAT_PAGE_SIZE = 20;

// ============================ 页面 ============================

/**
 * 物料数据管理（电脑端，base:product 或 base:category 任一可进）：
 * 合并原「材料管理」+「分类管理」—— 左侧三级分类树（导航 + 分类维护），右侧材料表格（完整 CRUD）。
 * 删除走审批流：材料/分类删除 → 提交删除申请 → 管理者及以上在「删除审核」页批准后执行。
 */
export function MaterialsDataPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canProducts = hasPerm("base:product"); // 材料操作
  const canCategories = hasPerm("base:category"); // 分类操作

  // ---- 分类树 ----
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeErr, setTreeErr] = useState("");
  const [kw, setKw] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>("all"); // all | uncategorized | cat:{id}
  const [allTotal, setAllTotal] = useState(0);
  const [uncatTotal, setUncatTotal] = useState(0);

  // ---- 材料表格 ----
  const [list, setList] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MAT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [barcode, setBarcode] = useState("");
  const [aiKeywords, setAiKeywords] = useState<string[]>([]);
  const [units, setUnits] = useState<{ id: number; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const supDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---- 分类编辑弹窗 ----
  const [catOpen, setCatOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<CategoryNode | null>(null);
  const [catParentPreset, setCatParentPreset] = useState(0);
  const [catForm] = Form.useForm();

  // ---- 材料编辑弹窗 ----
  const [matOpen, setMatOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form] = Form.useForm();
  const nameValue = Form.useWatch("name", form);
  const barcodeValue = Form.useWatch("barcode", form);
  const categoryValue = Form.useWatch("category_id", form);
  const nameFileRef = useRef<HTMLInputElement>(null);
  const barcodeFileRef = useRef<HTMLInputElement>(null);
  const nameAlbumRef = useRef<HTMLInputElement>(null);
  const barcodeAlbumRef = useRef<HTMLInputElement>(null);

  // ---- 移动分类（单条 / 批量）----
  const [moveTargets, setMoveTargets] = useState<Product[]>([]);
  const [moveCatId, setMoveCatId] = useState<number | undefined>(0);
  const [moving, setMoving] = useState(false);

  // ---- 删除申请（审批流）----
  const [delReview, setDelReview] = useState<{ bizType: "product" | "category"; targets: { id: number; name: string }[] } | null>(null);
  const [delReason, setDelReason] = useState("");
  const [delSubmitting, setDelSubmitting] = useState(false);

  // ---- 查重 ----
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [dedupeGroups, setDedupeGroups] = useState<{ group: { product_id: number; name: string; spec: string; material_code: string; unit_name: string }[]; reason: string; confidence: string }[]>([]);
  const [dedupeLoading, setDedupeLoading] = useState(false);

  const flat = useMemo(() => flattenCats(tree), [tree]);
  const byId = useMemo(() => new Map(flat.map((n) => [n.id, n])), [flat]);
  const selCat = selectedKey.startsWith("cat:") ? byId.get(Number(selectedKey.slice(4))) ?? null : null;
  const selDepth = selCat ? catDepth(selCat.id, byId) : 0;
  const cats = useMemo(() => leafCats(tree), [tree]);
  // 分类维护可见性：二级已挂材料不能再建子分类；三级不能再建
  const childBlocked = selCat ? selDepth >= 3 || (selDepth === 2 && (selCat.product_count ?? 0) > 0) : false;

  // ============================ 数据加载 ============================

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeErr("");
    try {
      setTree(await baseApi.categories());
    } catch (e) {
      setTreeErr(e instanceof Error ? e.message : "分类加载失败");
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTree();
    baseApi.units().then(setUnits).catch(() => undefined);
    baseApi.suppliers(1).then((d) => setSuppliers(d.list.map((s) => ({ id: s.id, name: s.name })))).catch(() => undefined);
  }, [loadTree]);

  // 顶部「全部材料 / 未分类」数量徽标（轻量统计，树加载后刷新）
  useEffect(() => {
    let alive = true;
    baseApi.products("", 1, { status: 1, pageSize: 1 }).then((d) => alive && setAllTotal(d.total)).catch(() => undefined);
    baseApi.products("", 1, { status: 1, pageSize: 1, uncategorized: 1 }).then((d) => alive && setUncatTotal(d.total)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tree]);

  /** 按左树选中 + 筛选条件加载材料（选中切换/关键词/条码变化回到第 1 页）。 */
  useEffect(() => {
    setPage(1);
  }, [selectedKey, keyword, barcode]);

  const load = useCallback(async () => {
    setLoading(true);
    setList([]);
    try {
      const extra = { barcode, status: 1, pageSize };
      const catExtra =
        selectedKey === "uncategorized"
          ? { uncategorized: 1 }
          : selCat
            ? { categoryId: selCat.id, descendants: selCat.parent_id === 0 ? 1 : 0 }
            : {};
      let data = await baseApi.products(keyword, page, { ...extra, ...catExtra });
      // 语义搜索：关键词无结果时本地子串扩展重查
      let aiKws: string[] = [];
      if (!data.total && keyword && page === 1) {
        const expanded = await baseApi.products(keyword, 1, { ...extra, ...catExtra, ai: 1 });
        if (expanded.total) {
          data = expanded as typeof data & { ai_keywords?: string[] };
          aiKws = (expanded as { ai_keywords?: string[] }).ai_keywords ?? [];
        }
      }
      setList(data.list);
      setTotal(data.total);
      setAiKeywords(aiKws);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, barcode, page, pageSize, selectedKey, selCat, message]);

  useEffect(() => {
    void load();
  }, [load]);

  // ============================ 分类维护 ============================

  function openCatCreate(parentId: number) {
    setCatEditing(null);
    setCatParentPreset(parentId);
    setCatOpen(true);
  }

  function openCatEdit(c: CategoryNode) {
    setCatEditing(c);
    setCatParentPreset(c.parent_id);
    setCatOpen(true);
  }

  async function saveCategory() {
    const v = await catForm.validateFields();
    const body = { parent_id: v.parent_id ?? 0, name: v.name.trim(), sort: v.sort ?? 0 };
    try {
      if (catEditing) {
        await baseApi.updateCategory(catEditing.id, body);
        message.success("分类已更新");
      } else {
        await baseApi.createCategory(body);
        message.success("分类已创建");
      }
      setCatOpen(false);
      void loadTree();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  /** 分类删除 → 提交删除申请（审批流），不直接删除。 */
  function requestDeleteCategory(c: CategoryNode) {
    setDelReview({ bizType: "category", targets: [{ id: c.id, name: c.name }] });
    setDelReason("");
  }

  const parentOptions = useMemo(() => {
    const out = [{ value: 0, label: "顶级分类" }];
    for (const n of tree) {
      out.push({ value: n.id, label: n.name });
      n.children?.forEach((c) => out.push({ value: c.id, label: `${n.name}/${c.name}` }));
    }
    return out;
  }, [tree]);

  // ============================ 材料维护 ============================

  function openMatCreate() {
    setEditing(null);
    form.resetFields();
    // 左树选中二级/三级分类时默认预选该分类
    if (selCat && selDepth >= 2) form.setFieldsValue({ category_id: selCat.id });
    setMatOpen(true);
  }

  function openMatEdit(p: Product) {
    setEditing(p);
    form.setFieldsValue({
      name: p.name,
      material_code: p.material_code,
      barcode: p.barcode,
      spec: p.spec,
      unit_id: p.unit_id,
      category_id: p.category_id || 0,
      purchase_price: Number(p.purchase_price || 0),
      min_stock: Number(p.min_stock || 0),
      max_stock: Number(p.max_stock || 0),
      remark: p.remark,
      supplier_ids: p.supplier_ids ?? [],
    });
    if (p.supplier_ids?.length) {
      setSuppliers((old) => {
        const have = new Set(old.map((s) => s.id));
        const extra = (p.supplier_ids ?? [])
          .map((id, i) => ({ id, name: p.supplier_names?.[i] ?? "" }))
          .filter((s) => s.id && s.name && !have.has(s.id));
        return extra.length ? [...old, ...extra] : old;
      });
    }
    setMatOpen(true);
  }

  async function saveMaterial() {
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
      setMatOpen(false);
      void load();
      void loadTree(); // 分类材料数徽标刷新
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function toggleStatus(p: Product) {
    try {
      await baseApi.updateProduct(p.id, { name: p.name, unit_id: p.unit_id, status: p.status === 1 ? 0 : 1 });
      message.success(p.status === 1 ? "已停用" : "已启用");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  function querySuppliers(k: string) {
    if (supDebounce.current) clearTimeout(supDebounce.current);
    const kk = k.trim();
    if (!kk) return;
    supDebounce.current = setTimeout(() => {
      void baseApi.suppliers(1, kk).then((d) => setSuppliers(d.list.map((s) => ({ id: s.id, name: s.name })))).catch(() => undefined);
    }, 300);
  }

  /** 拍照识别材料名称（OCR 快查）。 */
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

  /** 拍照扫码：解码条码并填入。 */
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

  // ============================ 移动分类 ============================

  const moveOptions = useMemo(() => {
    const out = [{ value: 0, label: "未分类" }];
    for (const n of tree) {
      n.children?.forEach((c) => {
        out.push({ value: c.id, label: `${n.name}/${c.name}` });
        c.children?.forEach((g) => out.push({ value: g.id, label: `${n.name}/${c.name}/${g.name}` }));
      });
    }
    return out;
  }, [tree]);

  function openMove(targets: Product[]) {
    setMoveTargets(targets);
    setMoveCatId(undefined);
  }

  async function doMove() {
    if (!moveTargets.length) return;
    if (moveCatId === undefined) {
      message.warning("请选择目标分类");
      return;
    }
    setMoving(true);
    try {
      for (const p of moveTargets) {
        await baseApi.updateProductCategory(p.id, moveCatId);
      }
      const catName = moveOptions.find((o) => o.value === moveCatId)?.label ?? "";
      message.success(`已将 ${moveTargets.length} 个材料移动至「${catName}」`);
      setMoveTargets([]);
      void load();
      void loadTree();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "移动失败");
    } finally {
      setMoving(false);
    }
  }

  // ============================ 删除申请 ============================

  /** 材料/分类删除统一入口：提交删除申请（需管理者审核）。 */
  function requestDeleteProducts(products: Product[]) {
    setDelReview({ bizType: "product", targets: products.map((p) => ({ id: p.id, name: p.name })) });
    setDelReason("");
  }

  async function submitDeleteReview() {
    if (!delReview) return;
    const reason = delReason.trim();
    if (!reason) {
      message.warning("请填写删除原因（审核依据）");
      return;
    }
    setDelSubmitting(true);
    try {
      let n = 0;
      for (const t of delReview.targets) {
        await baseApi.submitDeleteReview({ biz_type: delReview.bizType, target_id: t.id, reason });
        n += 1;
      }
      message.success(`已提交 ${n} 条删除申请，等待管理者审核`);
      setDelReview(null);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setDelSubmitting(false);
    }
  }

  // ============================ 查重 ============================

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

  // ============================ 渲染 ============================

  const filteredTree = useMemo(() => filterTree(tree, kw), [tree, kw]);

  // 树展开状态：默认首次加载全部展开；之后完全由用户收缩/展开控制（搜索时自动展开命中路径）
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const expandedInitRef = useRef(false);
  const parentKeys = useCallback((nodes: CategoryNode[]): React.Key[] => {
    const keys: React.Key[] = [];
    const walk = (ns: CategoryNode[]) => {
      for (const n of ns) {
        if (n.children?.length) {
          keys.push(`cat:${n.id}`); // 节点 key 为 cat:{id}，必须一致才会展开
          walk(n.children);
        }
      }
    };
    walk(nodes);
    return keys;
  }, []);

  useEffect(() => {
    if (!expandedInitRef.current && flat.some((n) => (n.children?.length ?? 0) > 0)) {
      setExpandedKeys(parentKeys(flat));
      expandedInitRef.current = true;
    }
  }, [flat, parentKeys]);

  // 搜索时自动展开命中路径（保留用户已收缩的节点）
  useEffect(() => {
    if (!kw) return;
    setExpandedKeys((prev) => Array.from(new Set([...prev, ...parentKeys(filteredTree)])));
  }, [kw, filteredTree, parentKeys]);

  function buildTreeItems(nodes: CategoryNode[], level: number): TreeItem[] {
    return nodes.map((n) => {
      const agg = level === 0 ? subtreeMats(n) : n.product_count ?? 0;
      return {
        key: `cat:${n.id}`,
        icon:
          level === 0 ? (
            <FolderOpenOutlined style={{ color: token.colorPrimary }} />
          ) : (
            <TagsOutlined style={{ color: level === 1 ? "#3c89f0" : token.colorTextTertiary }} />
          ),
        title: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={n.name}>
            <span style={{ display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170, verticalAlign: "middle" }}>{n.name}</span>
            {n.children?.length ? <Tag style={{ fontSize: 11, lineHeight: "16px", marginInlineEnd: 0, borderRadius: 999, background: "#EFF3FC", color: "#5B6478", borderColor: "transparent" }}>{n.children.length} 子类</Tag> : null}
            {agg > 0 ? <Tag style={{ fontSize: 11, lineHeight: "16px", marginInlineEnd: 0, borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent" }}>{agg} 种</Tag> : null}
          </span>
        ),
        children: n.children?.length ? buildTreeItems(n.children, level + 1) : undefined,
      };
    });
  }

  const treeData = useMemo<TreeItem[]>(
    () => [
      {
        key: "all",
        icon: <AppstoreOutlined style={{ color: token.colorPrimary }} />,
        title: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span>全部材料</span>
            {allTotal > 0 ? <Tag style={{ fontSize: 11, lineHeight: "16px", marginInlineEnd: 0, borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent" }}>{allTotal} 种</Tag> : null}
          </span>
        ),
      },
      {
        key: "uncategorized",
        icon: <DisconnectOutlined style={{ color: token.colorTextTertiary }} />,
        title: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span>未分类</span>
            {uncatTotal > 0 ? <Tag style={{ fontSize: 11, lineHeight: "16px", marginInlineEnd: 0, borderRadius: 999, background: "#EFF3FC", color: "#5B6478", borderColor: "transparent" }}>{uncatTotal} 种</Tag> : null}
          </span>
        ),
      },
      ...buildTreeItems(filteredTree, 0),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredTree, allTotal, uncatTotal, token, canCategories]
  );

  const columns: ColumnsType<Product> = [
    { title: "物料编码", dataIndex: "material_code", width: 110, render: (v: string) => v || "-" },
    { title: "条码", dataIndex: "barcode", width: 130, render: (v: string) => v || <span style={{ color: "#c0c4cc" }}>未录</span> },
    { title: "材料名称", dataIndex: "name", width: 150 },
    { title: "型号规格", dataIndex: "spec", width: 110, render: (v: string) => v || "-" },
    { title: "单位", dataIndex: "unit_name", width: 60 },
    { title: "分类", dataIndex: "category_name", width: 110, render: (v: string) => v || <span style={{ color: "#c0c4cc" }}>未分类</span> },
    { title: "库存", dataIndex: "stock_qty", width: 80, align: "right" as const, render: (v?: string) => (v === undefined ? "0" : v) },
    { title: "供应商", dataIndex: "supplier_names", width: 150, render: (v: string[]) => (v?.length ? v.join("、") : <span style={{ color: "#c0c4cc" }}>未关联</span>) },
    { title: "价格", dataIndex: "purchase_price", width: 80, align: "right" as const },
    { title: "下限", dataIndex: "min_stock", width: 70, align: "right" as const },
    { title: "上限", dataIndex: "max_stock", width: 70, align: "right" as const },
    { title: "状态", dataIndex: "status", width: 70, render: (v: number) => (v === 1
      ? <Tag style={{ borderRadius: 999, background: "#E8F9EF", color: "#15803D", borderColor: "transparent", marginInlineEnd: 0 }}>启用</Tag>
      : <Tag style={{ borderRadius: 999, background: "#EFF3FC", color: "#64748B", borderColor: "transparent", marginInlineEnd: 0 }}>停用</Tag>) },
  ];

  // 当前选中的展示标题（右侧表格上方）
  const selectionTitle = useMemo(() => {
    if (selectedKey === "uncategorized") return "未分类材料（未挂载到任何分类）";
    if (selCat) {
      const path: string[] = [];
      let cur: CategoryNode | undefined = selCat;
      while (cur) {
        path.unshift(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      return path.join(" / ");
    }
    return "全部材料";
  }, [selectedKey, selCat, byId]);

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1E2433", letterSpacing: "-0.01em" }}>物料数据管理</h2>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: token.colorTextSecondary }}>
            左侧分类树导航并维护分类（三级）；右侧管理材料。删除材料/分类需提交删除申请，由管理者及以上审核
          </p>
        </div>
        <Space>
          <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<ReloadOutlined style={{ color: "#5B7FFF" }} />} onClick={() => { void load(); void loadTree(); }}>刷新</Button>
          {canCategories && (
            <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} icon={<PlusOutlined style={{ color: "#5B7FFF" }} />} onClick={() => openCatCreate(0)}>新建顶级分类</Button>
          )}
          {canProducts && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openMatCreate}>新建材料</Button>
          )}
        </Space>
      </div>

      {treeErr && (
        <div style={{ marginBottom: 12 }}>
          <Button type="link" danger onClick={() => void loadTree()}>分类加载失败，点击重试</Button>
        </div>
      )}

      {/* 主从布局：左分类树 + 右材料表格 */}
      <div
        className="wlt-cat-layout"
        style={{
          display: "flex",
          background: token.colorBgContainer,
          border: `1px solid #E4EAF6`,
          borderRadius: 16,
          boxShadow: "0 6px 24px rgba(30,36,51,.06)",
          minHeight: 520,
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
          {treeLoading && !tree.length ? (
            <Skeleton active paragraph={{ rows: 6 }} title={false} style={{ padding: "4px 8px" }} />
          ) : (
            <Tree
              blockNode
              showIcon
              showLine
              treeData={treeData}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys)}
              selectedKeys={[selectedKey]}
              onSelect={(keys) => {
                const k = keys[0];
                setSelectedKey(k ? String(k) : "all");
              }}
              style={{ flex: 1, overflow: "auto", background: "transparent" }}
            />
          )}
          <div style={{ paddingTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}`, fontSize: 12, color: token.colorTextSecondary }}>
            共 {flat.length} 个分类 · 三级结构{canProducts && (
              <Button size="small" type="link" icon={<AuditOutlined />} style={{ padding: 0, marginLeft: 8 }} onClick={() => window.open("/delete-reviews", "_self")}>
                删除审核
              </Button>
            )}
          </div>
        </aside>

        {/* 右：材料表格 */}
        <main style={{ flex: 1, minWidth: 0, padding: 16, display: "flex", flexDirection: "column" }}>
          {/* 选中分类信息 + 分类操作（仅选中真实分类时展示） */}
          {selCat && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8, padding: "8px 12px", background: "#F6F8FE", borderRadius: 12 }}>
              <Space size={8} wrap>
                <span style={{ fontWeight: 600 }}>{selectionTitle}</span>
                {selCat.parent_id === 0 ? <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}>顶级分类（仅分组，聚合子树材料）</Tag> : <Tag style={{ borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}>{selCat.product_count ?? 0} 种材料</Tag>}
                {selDepth >= 3 ? <Tag style={{ borderRadius: 999, background: "#EFF3FC", color: "#5B6478", borderColor: "transparent", marginInlineEnd: 0 }}>三级分类</Tag> : selDepth === 2 ? <Tag style={{ borderRadius: 999, background: "#EFF3FC", color: "#5B6478", borderColor: "transparent", marginInlineEnd: 0 }}>二级分类</Tag> : null}
              </Space>
              {canCategories && (
                <Space size={4}>
                  <Tooltip title={childBlocked ? (selDepth >= 3 ? "分类最多三级，三级分类下不能再建子分类" : "该分类已挂载材料，不能再创建子分类") : ""}>
                    <Button size="small" disabled={childBlocked} icon={<PlusOutlined />} onClick={() => openCatCreate(selCat.id)}>新建子分类</Button>
                  </Tooltip>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openCatEdit(selCat)}>编辑</Button>
                  <Popconfirm title={`确认申请删除分类「${selCat.name}」？`} description="将提交删除申请，由管理者及以上审核通过后删除" onConfirm={() => requestDeleteCategory(selCat)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>删除申请</Button>
                  </Popconfirm>
                </Space>
              )}
            </div>
          )}

          {/* 材料工具栏 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Input.Search
              placeholder="材料名称 / 编码 / 物料编码 / 规格"
              allowClear
              style={{ width: 280 }}
              onSearch={(v) => { setKeyword(v.trim()); }}
            />
            <Input
              placeholder="条码精确查询"
              allowClear
              style={{ width: 160, background: "#F6F8FE" }}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value.trim())}
              onPressEnter={() => setPage(1)}
            />
            {aiKeywords.length > 0 && <Tag style={{ alignSelf: "center", borderRadius: 999, background: "#EAEFFF", color: "#3B5BDB", borderColor: "transparent", marginInlineEnd: 0 }}>已扩展搜索词：{aiKeywords.join(" / ")}</Tag>}
            {canProducts && (
              <Button style={{ borderColor: "#CBD6EC", color: "#1E2433", background: "#FFFFFF" }} loading={dedupeLoading} onClick={() => void runDedupe()}>查重</Button>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ alignSelf: "center", fontSize: 12, color: "#8A93A8" }}>{selectionTitle} · 共 {total} 种</span>
          </div>

          <DataTable
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={list}
            locale={{ emptyText: "暂无材料" }}
            scroll={{ x: 1250 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (p: number, ps: number) => {
                if (ps !== pageSize) {
                  setPage(1);
                  setPageSize(ps);
                } else {
                  setPage(p);
                }
              },
            }}
            rowSelection={canProducts}
            batchActions={
              canProducts
                ? [
                    {
                      label: "批量停用",
                      confirm: "确定停用选中的材料？停用后不再参与识别/匹配，可随时启用。",
                      onClick: async (keys) => {
                        for (const k of keys) await baseApi.deleteProduct(Number(k));
                        message.success(`已停用 ${keys.length} 个材料`);
                        void load();
                      },
                    },
                    {
                      label: "批量移动分类",
                      onClick: (keys) => {
                        const targets = list.filter((p) => keys.includes(p.id));
                        if (targets.length) openMove(targets);
                      },
                    },
                    {
                      label: "批量删除申请",
                      danger: true,
                      confirm: "将为选中的材料各提交一条删除申请，需管理者及以上审核通过后生效。",
                      onClick: (keys) => {
                        const targets = list.filter((p) => keys.includes(p.id));
                        if (targets.length) requestDeleteProducts(targets);
                      },
                    },
                  ]
                : undefined
            }
            actionsWidth={220}
            actions={(r) => (
              <Space size={4}>
                {canProducts && (
                  <>
                    <Button size="small" onClick={() => openMatEdit(r)}>编辑</Button>
                    <Popconfirm title={r.status === 1 ? "确认停用该材料？" : "确认启用该材料？"} onConfirm={() => void toggleStatus(r)}>
                      <Button size="small" danger={r.status === 1}>{r.status === 1 ? "停用" : "启用"}</Button>
                    </Popconfirm>
                    <Tooltip title="移动分类">
                      <Button size="small" icon={<SwapOutlined />} onClick={() => openMove([r])} />
                    </Tooltip>
                    <Popconfirm
                      title={`确认申请删除「${r.name}」？`}
                      description="将提交删除申请，由管理者及以上审核通过后停用"
                      onConfirm={() => requestDeleteProducts([r])}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />}>删除申请</Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            )}
          />
        </main>
      </div>

      {/* 分类新建/编辑弹窗 */}
      <Modal
        title={catEditing ? `编辑分类：${catEditing.name}` : catParentPreset !== 0 ? `新建子分类：${byId.get(catParentPreset)?.name ?? ""}` : "新建分类"}
        open={catOpen}
        onOk={() => void saveCategory()}
        onCancel={() => setCatOpen(false)}
        width={420}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (!o) return;
          if (catEditing) {
            catForm.setFieldsValue({ parent_id: catEditing.parent_id, name: catEditing.name, sort: catEditing.sort ?? 0 });
          } else {
            catForm.resetFields();
            catForm.setFieldsValue({ parent_id: catParentPreset, sort: 0 });
          }
        }}
      >
        <Form form={catForm} layout="vertical">
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

      {/* 材料新建/编辑弹窗 */}
      <Modal
        title={editing ? `编辑材料：${editing.name}` : "新建材料"}
        open={matOpen}
        onOk={() => void saveMaterial()}
        onCancel={() => setMatOpen(false)}
        width={600}
        forceRender
      >
        <input ref={nameFileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void ocrName(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={nameAlbumRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void ocrName(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={barcodeFileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void scanBarcode(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={barcodeAlbumRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void scanBarcode(e.target.files?.[0]); e.target.value = ""; }} />
        <Form form={form} layout="vertical">
          {/* 分节一：基础信息 */}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3B5BDB", display: "flex", alignItems: "center", gap: 8, margin: "2px 0 12px" }}>
            <span style={{ width: 3, height: 12, borderRadius: 2, background: "#5B7FFF", display: "inline-block" }} />
            基础信息
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: "10px 14px" }}>
            <Form.Item name="name" label="材料名称" rules={[{ required: true, message: "请输入材料名称" }]} style={{ marginBottom: 0 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Input placeholder="如：轴承6204" maxLength={100} value={nameValue} onChange={(e) => form.setFieldValue("name", e.target.value)} />
                <Button icon={<CameraOutlined style={{ color: "#5B7FFF" }} />} title="拍照识别名称" onClick={() => nameFileRef.current?.click()} />
                <Button icon={<PictureOutlined style={{ color: "#5B7FFF" }} />} title="相册选图识别名称" onClick={() => nameAlbumRef.current?.click()} />
              </Space.Compact>
            </Form.Item>
            <Form.Item name="unit_id" label="基本单位" rules={[{ required: true, message: "请选择单位" }]} style={{ marginBottom: 0 }}>
              <Select placeholder="选择" options={units} fieldNames={{ label: "name", value: "id" }} />
            </Form.Item>
            <Form.Item name="barcode" label="条码（可选，扫码录入用）" style={{ marginBottom: 0 }}>
              <Space.Compact style={{ width: "100%" }}>
                <Input placeholder="扫码枪/手输，或拍照扫码" maxLength={50} value={barcodeValue} onChange={(e) => form.setFieldValue("barcode", e.target.value)} />
                <Button icon={<CameraOutlined style={{ color: "#5B7FFF" }} />} title="拍照识别条码" onClick={() => barcodeFileRef.current?.click()} />
                <Button icon={<PictureOutlined style={{ color: "#5B7FFF" }} />} title="相册选图识别条码" onClick={() => barcodeAlbumRef.current?.click()} />
              </Space.Compact>
            </Form.Item>
            <Form.Item name="material_code" label="物料编码（可选）" style={{ marginBottom: 0 }}>
              <Input placeholder="留空则提示管理员补录" maxLength={50} />
            </Form.Item>
            <Form.Item name="spec" label="型号规格" style={{ marginBottom: 0 }}>
              <Input placeholder="如：20x12" maxLength={100} />
            </Form.Item>
            <Form.Item name="category_id" label="分类" style={{ marginBottom: 0 }}>
              <Select
                placeholder="选择（含未分类）"
                allowClear
                options={categoryValue && !cats.some((c) => c.id === categoryValue) ? [{ id: categoryValue, name: "原分类（请改挂二级/三级）" }, ...cats] : cats}
                fieldNames={{ label: "name", value: "id" }}
              />
            </Form.Item>
          </div>

          {/* 分节二：采购与库存 */}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3B5BDB", display: "flex", alignItems: "center", gap: 8, margin: "16px 0 12px" }}>
            <span style={{ width: 3, height: 12, borderRadius: 2, background: "#5B7FFF", display: "inline-block" }} />
            采购与库存
          </div>
          <Form.Item name="supplier_ids" label="关联供应商（可多选）" style={{ marginBottom: 10 }}>
            <Select
              mode="multiple"
              placeholder="输入名称搜索 / 选择"
              allowClear
              showSearch
              filterOption={false}
              onSearch={querySuppliers}
              options={suppliers}
              fieldNames={{ label: "name", value: "id" }}
              maxTagCount={3}
            />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            <Form.Item name="purchase_price" label="参考价格（元）" style={{ marginBottom: 0 }}>
              <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="0.00" />
            </Form.Item>
            <Form.Item name="min_stock" label="库存下限" style={{ marginBottom: 0 }}>
              <InputNumber min={0} precision={3} style={{ width: "100%" }} placeholder="预警阈值" />
            </Form.Item>
            <Form.Item name="max_stock" label="库存上限" style={{ marginBottom: 0 }}>
              <InputNumber min={0} precision={3} style={{ width: "100%" }} placeholder="容量上限" />
            </Form.Item>
          </div>

          {/* 分节三：备注 */}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3B5BDB", display: "flex", alignItems: "center", gap: 8, margin: "16px 0 12px" }}>
            <span style={{ width: 3, height: 12, borderRadius: 2, background: "#5B7FFF", display: "inline-block" }} />
            备注
          </div>
          <Form.Item name="remark" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} maxLength={255} placeholder="选填：用途、存放要求等补充说明" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 移动分类弹窗（单条/批量） */}
      <Modal
        title={`移动分类：${moveTargets.length > 1 ? `${moveTargets.length} 个材料` : moveTargets[0]?.name ?? ""}`}
        open={Boolean(moveTargets.length)}
        onOk={() => void doMove()}
        okText="移动"
        confirmLoading={moving}
        onCancel={() => setMoveTargets([])}
        width={420}
        destroyOnHidden
        afterOpenChange={(o) => {
          if (o) setMoveCatId(undefined);
        }}
      >
        <div style={{ fontSize: 13, color: token.colorTextSecondary, marginBottom: 8 }}>
          目标分类可选二级/三级分类或未分类
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

      {/* 删除申请弹窗（审批流：材料/分类统一入口） */}
      <Modal
        title="提交删除申请"
        open={Boolean(delReview)}
        onOk={() => void submitDeleteReview()}
        okText="提交申请"
        confirmLoading={delSubmitting}
        onCancel={() => setDelReview(null)}
        width={480}
        destroyOnHidden
      >
        <div style={{ marginBottom: 12 }}>
          {delReview && (
            <div style={{ fontSize: 13, color: token.colorTextSecondary, marginBottom: 8 }}>
              目标：{delReview.targets.map((t) => t.name).join("、")}（{delReview.targets.length} 个）
              <br />
              {delReview.bizType === "product" ? "审核通过后材料将被停用（可再启用）；" : "审核通过后分类将被删除（有子分类或材料时审核会被自动拒绝）。"}
              申请将通知管理者及以上角色。
            </div>
          )}
          <Input.TextArea
            rows={3}
            maxLength={500}
            placeholder="请填写删除原因（必填，作为审核依据）"
            value={delReason}
            onChange={(e) => setDelReason(e.target.value)}
          />
        </div>
      </Modal>

      {/* 材料查重结果 */}
      <Drawer title="材料查重建议（仅供参考）" open={dedupeOpen} onClose={() => setDedupeOpen(false)} size={680}>
        {dedupeGroups.length === 0 && !dedupeLoading && <Typography.Text type="secondary">未发现疑似重复材料</Typography.Text>}
        {dedupeGroups.map((g, gi) => (
          <div key={gi} style={{ border: "1px solid #E4EAF6", borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Tag style={{ borderRadius: 999, background: g.confidence === "high" ? "#FDEBEC" : "#FEF4E2", color: g.confidence === "high" ? "#DC2626" : "#B45309", borderColor: "transparent", marginInlineEnd: 0 }}>{g.confidence === "high" ? "高置信" : "相似"}</Tag>
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
