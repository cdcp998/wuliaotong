/** 操作日志字段级对比的元数据与格式化规则（设计文档：AI开发文档/操作日志详情展示方案.md）。
 *
 * - FIELD_LABELS：字段名 → 中文名（通用优先，表级覆盖）；
 * - SENSITIVE_DISPLAY：敏感字段的脱敏显示规则；
 * - formatDiffValue(field, value)：旧/新值的友好格式化（null/布尔/时间/金额/枚举/手机号…）；
 * - summarizeDiff(log)：列表「关键修改摘要」提取（修改了 A、B、C 等 N 项）。
 */

/** 表名 → 中文名（分组标题用）。 */
export const TABLE_LABELS: Record<string, string> = {
  sys_user: "用户账号",
  sys_role: "角色",
  base_product: "材料档案",
  base_category: "材料分类",
  base_supplier: "供应商",
  base_warehouse: "仓库",
  base_shelf: "货架",
  base_location: "库位",
  base_department: "组织单位",
  sys_menu: "导航菜单",
  sys_register_apply: "注册申请",
  sys_delete_review: "删除审核",
  sys_module: "模块配置",
  map_cache_region: "地图缓存区域",
  map_source_config: "地图源配置",
  dev_device: "设备台账",
  knl_article: "知识条目",
  tsk_task: "维修任务",
  cab_cable: "线缆",
  cable_fault: "故障单",
};

/** 字段中文名映射（跨表通用 + 少量精确覆盖，未命中回退原字段名）。 */
const GENERIC_FIELD_LABELS: Record<string, string> = {
  name: "名称", real_name: "姓名", username: "登录名", code: "编码",
  spec: "规格型号", unit_name: "计量单位", unit_id: "计量单位",
  phone: "手机号", email: "邮箱", contact_phone: "联系电话",
  remark: "备注", description: "描述", note: "备注说明",
  status: "状态", enabled: "启用状态", visible: "是否显示",
  role_id: "角色", department_id: "所属单位", category_id: "所属分类",
  parent_id: "上级分类", supplier_ids: "关联供应商",
  purchase_price: "参考价格", price: "价格", cost_price: "成本价",
  min_stock: "库存下限", max_stock: "库存上限", qty: "数量",
  barcode: "条码", material_code: "物料编码", password: "密码",
  title: "标题", priority: "优先级", assignee_id: "维修人员",
  fault_type: "故障类型", severity: "严重度", latency: "时延",
  min_zoom: "最小缩放级别", max_zoom: "最大缩放级别", update_mode: "更新模式",
  url_template: "URL 模板", api_key: "API Key", sort: "排序",
  start_date: "开始日期", end_date: "结束日期", bill_no: "单据号",
  type: "类型", model: "模型", version: "版本", path: "路由路径",
  icon: "图标", perm_code: "权限码", geometry: "区域范围", bbox: "边界框",
};

/** 敏感字段显示规则：full=完全打码；phone=手机号中间四位；idcard=前4后4；bank=前4后4。 */
export const SENSITIVE_DISPLAY: Record<string, "full" | "phone" | "idcard" | "bank"> = {
  password: "full",
  password_hash: "full",
  secret: "full",
  token: "full",
  api_key: "full",
  api_secret: "full",
  phone: "phone",
  contact_phone: "phone",
  id_card: "idcard",
  idcard: "idcard",
  bank_card: "bank",
  bank_no: "bank",
};

/** 状态数值枚举（常见状态字典；未知值回退原样）。 */
const STATUS_ENUMS: Record<string, Record<string, string>> = {
  status: { "0": "停用/待处理", "1": "启用/处理中", "2": "已完成/已驳回", "3": "已暂停", "4": "已关闭" },
  priority: { "1": "普通", "2": "紧急" },
};

/** 判断字段值是否为时间型文本（ISO / YYYY-MM-DD HH:mm:ss）。 */
function looksLikeTime(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(s);
}

/** 单值友好格式化（不含脱敏——脱敏在 maskValue 中按需叠加）。 */
export function formatDiffValue(field: string, value: string | null): string {
  if (value === null || value === undefined || value === "") return "（空）";
  // 时间
  if (field.endsWith("_at") || field.endsWith("date") || looksLikeTime(value)) {
    if (looksLikeTime(value)) return value.replace("T", " ");
  }
  // 布尔语义（后端序列化已是 是/否）
  if (value === "是" || value === "否") return value;
  // 数值枚举
  const enumMap = STATUS_ENUMS[field];
  if (enumMap && enumMap[value]) return `${enumMap[value]}（${value}）`;
  // 手机号（11 位纯数字）
  if (/^1\d{10}$/.test(value)) return value.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
  // 身份证（18 位）
  if (/^\d{17}[\dXx]$/.test(value)) return `${value.slice(0, 4)}***********${value.slice(-3)}`;
  // 银行卡（16~19 位数字）
  if (/^\d{16,19}$/.test(value)) return `${value.slice(0, 4)} **** **** ${value.slice(-4)}`;
  return value;
}

/** 脱敏显示（密码等全打码字段在 diff 序列化时已被后端打码；此处兜底手机号等）。 */
export function maskValue(field: string, value: string | null): string {
  if (value === null || value === undefined) return "（空）";
  const rule = SENSITIVE_DISPLAY[field];
  if (rule === "full") return "******";
  if (rule === "phone") {
    if (/^1\d{10}$/.test(value)) return value.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
    return value ? "******" : value;
  }
  if (rule === "idcard") return value.length >= 7 ? `${value.slice(0, 4)}***********${value.slice(-3)}` : "******";
  if (rule === "bank") return value.length >= 8 ? `${value.slice(0, 4)} **** **** ${value.slice(-4)}` : "******";
  return formatDiffValue(field, value);
}

export function fieldLabel(table: string, field: string): string {
  const specific = TABLE_LABELS[table] ? undefined : undefined;
  void specific;
  return GENERIC_FIELD_LABELS[field] ?? fieldLabelFromTable(table, field) ?? field;
}

function fieldLabelFromTable(table: string, field: string): string | null {
  // 表级精确覆盖（少量易混淆字段）
  const overrides: Record<string, Record<string, string>> = {
    sys_user: { name: "登录名" },
    base_warehouse: { name: "仓库名称" },
    map_cache_region: { name: "区域名称" },
  };
  return overrides[table]?.[field] ?? GENERIC_FIELD_LABELS[field] ?? null;
}

/** diff JSON 解析结果的一行变更。 */
export interface DiffRow {
  table: string;
  tableLabel: string;
  pk: string;
  op: "update" | "insert" | "delete";
  fields: { field: string; label: string; old: string | null; new: string | null }[];
}

/** 解析日志 diff JSON → 分表变更行（解析失败返回空数组）。 */
export function parseDiff(diffText: string): DiffRow[] {
  if (!diffText) return [];
  try {
    const parsed = JSON.parse(diffText) as { tables?: Record<string, { pk?: string; op?: string; fields?: Record<string, { old: string | null; new: string | null }> }> };
    const rows: DiffRow[] = [];
    for (const [table, info] of Object.entries(parsed.tables ?? {})) {
      const fields = Object.entries(info.fields ?? {}).map(([field, pair]) => ({
        field,
        label: fieldLabel(table, field),
        old: pair.old ?? null,
        new: pair.new ?? null,
      }));
      rows.push({
        table,
        tableLabel: TABLE_LABELS[table] ?? table,
        pk: info.pk ?? "",
        op: (info.op as DiffRow["op"]) ?? "update",
        fields,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

/** 列表「关键修改摘要」：如「修改了 用户状态、手机号、所属单位」/「新增了 …」/「删除了 …」。 */
export function summarizeDiff(diffText: string, method: string): string {
  const rows = parseDiff(diffText);
  if (!rows.length) return "";
  const verb =
    method === "POST" || rows.every((r) => r.op === "insert")
      ? "新增"
      : method === "DELETE" || rows.every((r) => r.op === "delete")
        ? "删除"
        : "修改";
  const labels = rows.flatMap((r) => r.fields.map((f) => f.label));
  const uniq = [...new Set(labels)];
  if (!uniq.length) return "";
  const head = uniq.slice(0, 3).join("、");
  return `${verb}了 ${head}${uniq.length > 3 ? ` 等 ${uniq.length} 项` : ""}`;
}
