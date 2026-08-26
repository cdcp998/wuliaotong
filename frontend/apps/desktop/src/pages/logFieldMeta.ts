/** 操作日志字段级对比的元数据与格式化规则（设计文档：AI开发文档/操作日志详情展示方案.md）。
 *
 * - FIELD_LABELS：字段名 → 中文名（通用优先，表级覆盖）；
 * - SENSITIVE_DISPLAY：敏感字段的脱敏显示规则；
 * - formatDiffValue(field, value)：旧/新值的友好格式化（null/布尔/时间/金额/枚举/手机号…）；
 * - summarizeDiff(log)：列表「关键修改摘要」提取（修改了 A、B、C 等 N 项）；
 * - 全程只展示中文字段名：未命中映射按 snake/camel 分词自动汉化，
 *   仍失败归并为「其他字段」，任何视图都不再回退英文原名。
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

  // ── 通用补充（对齐 backend/app/models 全部列名，未命中再走分词汉化）──
  // 联系/文本
  address: "地址", contact: "联系人", content: "内容", reason: "原因",
  state: "状态", success: "是否成功", sku: "SKU", link: "链接", url: "链接地址",
  error: "错误信息", output: "输出结果", suggestion: "建议", prompt: "提示词",
  structured: "结构化数据", raw_result: "原始返回", retry_count: "重试次数",
  session_id: "会话", notification_id: "通知", checksum: "校验码", md5: "MD5 校验值",
  idempotency_key: "幂等键", depends: "依赖模块", schema_version: "结构版本",
  channel: "渠道", channels: "推送渠道", policy: "策略", provider: "服务商", engine: "引擎",
  scene: "场景", config: "配置内容", config_key: "配置项", config_value: "配置值",
  is_builtin: "是否内置", is_default: "是否默认", is_private: "是否私有", is_read: "是否已读",
  // 人员 / 审批
  creator_id: "创建人", operator_id: "操作员", manager_id: "负责人", uploader_id: "上传人",
  applicant_id: "申请人", applicant_name: "申请人", audit_by: "审核人", handled_by: "处理人",
  checker_id: "盘点人", user_id: "用户", recipient: "接收人",
  audit_remark: "审核备注", review_remark: "复核备注",
  // 时间类
  audit_time: "审核时间", handled_at: "处理时间", executed_at: "执行时间",
  expire_at: "过期时间", sent_at: "发送时间", installed_at: "安装日期",
  last_login_at: "最后登录时间", last_error_at: "最近错误时间", work_done_at: "完工时间",
  check_date: "盘点日期", plan_date: "计划日期", bill_date: "单据日期",
  last_error: "最近错误",
  // 数量 / 金额
  amount: "金额", total_amount: "总金额", est_price: "预估价格", rate: "单价",
  before_qty: "变动前数量", after_qty: "变动后数量", change_qty: "变动数量",
  diff_qty: "差异数量", book_qty: "账面数量", planned_qty: "计划数量",
  real_qty: "实际数量", total_qty: "总数量",
  // 单据 / 业务对象
  bill_id: "关联单据", bill_item_id: "单据明细", bill_type: "单据类型",
  biz_id: "业务对象", biz_type: "业务类型", plan_id: "计划单", transfer_id: "调拨单",
  requisition_id: "领用单", check_id: "盘点单", change_type: "变动类型",
  io_type: "出入库类型", ocr_bill_no: "OCR 单据号", ocr_record_id: "OCR 记录",
  ocr_type: "OCR 类型", match_status: "匹配状态", matched_product_id: "匹配材料",
  new_product_id: "新材料", product_id: "材料", product_name: "材料名称",
  target_id: "目标对象", target_name: "目标名称", target_desc: "目标描述",
  display_location: "展示货位", display_reason: "展示原因", use_location: "使用位置",
  use_reason: "领用原因", delivery_file_ids: "送货单附件", module_code: "模块编码",
  permission_id: "权限", storage_id: "存储配置", backup_type: "备份类型",
  original_name: "原始文件名", file_id: "附件文件", file_path: "文件路径", file_size: "文件大小",
  photo_file_id: "现场照片", image_file_id: "图片附件", location_photo_file_id: "库位照片",
  work_photo_file_id: "完工照片", provider_message_id: "服务商消息 ID",
  // 位置 / 层级
  location_id: "库位", shelf_id: "货架", warehouse_id: "仓库", supplier_id: "供应商",
  col_no: "列号", row_no: "行号", layer_no: "层号", work_lat: "纬度", work_lng: "经度",
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

/** 表级精确覆盖（少量易混淆字段）。 */
const TABLE_FIELD_OVERRIDES: Record<string, Record<string, string>> = {
  sys_user: { name: "登录名" },
  base_warehouse: { name: "仓库名称" },
  map_cache_region: { name: "区域名称" },
};

/** 分词汉化词表（autoLabel 兜底用：GENERIC 未覆盖的单词片段）。 */
const TOKEN_LABELS: Record<string, string> = {
  min: "最小", max: "最大", from: "调出", to: "调入", before: "变动前", after: "变动后",
  is: "是否", total: "合计", real: "实际", plan: "计划", planned: "计划", book: "账面",
  change: "变动", diff: "差异", last: "最近", work: "现场", done: "完工", handled: "处理",
  audit: "审核", review: "复核", check: "盘点", checker: "盘点人", creator: "创建人",
  operator: "操作员", manager: "负责人", uploader: "上传人", applicant: "申请人",
  recipient: "接收人", sent: "发送", executed: "执行", expire: "过期",
  installed: "安装", login: "登录", error: "错误", retry: "重试", count: "次数",
  display: "展示", use: "使用", io: "出入库", target: "目标", match: "匹配", matched: "匹配",
  new: "新", original: "原始", upload: "上传", session: "会话", notification: "通知",
  key: "键", value: "值", size: "大小", file: "文件", photo: "照片", image: "图片",
  date: "日期", time: "时间", at: "时间", by: "人",
  id: "ID", no: "编号", name: "名称", code: "编码", type: "类型", status: "状态",
  qty: "数量", price: "价格", amount: "金额", stock: "库存",
  warehouse: "仓库", shelf: "货架", location: "库位", product: "材料", category: "分类",
  department: "单位", supplier: "供应商", user: "用户", role: "角色", module: "模块",
  bill: "单据", item: "明细", biz: "业务", ocr: "OCR", lat: "纬度", lng: "经度",
  level: "级别", row: "行", col: "列", layer: "层", url: "链接", link: "链接",
  phone: "手机号", email: "邮箱", contact: "联系人", address: "地址", remark: "备注",
  desc: "描述", description: "描述", title: "标题", content: "内容", reason: "原因",
  enabled: "启用", visible: "显示", default: "默认", builtin: "内置", private: "私有",
  read: "已读", sort: "排序", icon: "图标", version: "版本", engine: "引擎",
  provider: "服务商", scene: "场景", policy: "策略", prompt: "提示词", output: "输出",
  result: "结果", raw: "原始", structured: "结构化", backup: "备份", storage: "存储",
  transfer: "调拨", requisition: "领用", perm: "权限", permission: "权限", menu: "菜单",
  map: "地图", cache: "缓存", region: "区域", source: "源", zoom: "缩放", template: "模板",
  mode: "模式", update: "更新", updated: "更新", created: "创建", start: "开始", end: "结束",
  severity: "严重度", priority: "优先级", fault: "故障", task: "任务", device: "设备",
  article: "知识条目", cable: "线缆", spec: "规格", unit: "单位", barcode: "条码",
  material: "物料", secret: "密钥", token: "令牌", password: "密码", hash: "哈希",
  api: "API", schema: "结构", depends: "依赖", checksum: "校验", md5: "MD5",
  idempotency: "幂等", channel: "渠道", message: "消息", state: "状态", success: "成功",

  // ── 路由动词 / 操作词（URL 尾段与动作词兜底）──
  install: "安装", uninstall: "卸载", disable: "停用", stop: "停止", pause: "暂停",
  resume: "继续", restart: "重启", clean: "清理", download: "下载",
  import: "导入", export: "导出", register: "注册", refresh: "刷新", sync: "同步",
  reset: "重置", cancel: "取消", confirm: "确认", submit: "提交",
  test: "测试", run: "执行", exec: "执行", execute: "执行", restore: "恢复",
  recover: "恢复", validate: "校验", toggle: "切换", batch: "批量", bulk: "批量",
  approve: "通过", reject: "驳回", publish: "发布", revoke: "撤销", assign: "派发",
  receive: "接收", finish: "完成", complete: "完成", close: "关闭", open: "开启",
  lock: "锁定", unlock: "解锁", remove: "移除", search: "搜索", detail: "详情",
  info: "详情", stats: "统计", setting: "设置", settings: "设置", preview: "预览",
  apply: "申请", deny: "拒绝", force: "强制", health: "健康", online: "在线",
  offline: "离线", profile: "资料", avatar: "头像", overview: "概览", dashboard: "看板",
  enable: "启用", clear: "清理", report: "上报", dispatch: "派发",
  bind: "绑定", unbind: "解绑", move: "移动", copy: "复制", duplicate: "复制",
  merge: "合并", split: "拆分", archive: "归档", reorder: "调序", recall: "撤回",
  withdraw: "撤回", sign: "签收", print: "打印", scan: "扫描", generate: "生成",
  parse: "解析", recognize: "识别", extract: "提取", index: "索引", rebuild: "重建",
  migrate: "迁移", upgrade: "升级", downgrade: "降级", activate: "激活",
  suspend: "冻结", freeze: "冻结", unfreeze: "解冻",
  page: "页", keyword: "关键词",
};

/** 路由整段优先词（与字段分词含义冲突或需整体认读时优先命中）。 */
const ROUTE_ONLY_LABELS: Record<string, string> = {
  check: "检查",           // 字段分词中 check=盘点，路由语境应为「检查」
  me: "我的", all: "全部", logout: "退出登录",
};

/** 列表摘要的查询参数名映射（接口入参，非实体字段；未命中的参数不上屏）。 */
const QUERY_PARAM_LABELS: Record<string, string> = {
  page: "页码", page_size: "每页条数", keyword: "关键词",
  descendants: "含子级", uncategorized: "仅未分类", fmt: "导出格式",
  mode: "模式", ai: "AI", q: "关键词",
};

/** 兜底汉化：snake/kebab/camel 拆词逐段翻译（全部词可译才生效，避免半中半英）。 */
function autoLabel(field: string): string | null {
  const tokens = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  if (!tokens.length) return null;
  const parts: string[] = [];
  for (const t of tokens) {
    const hit = GENERIC_FIELD_LABELS[t] ?? TOKEN_LABELS[t];
    if (hit === undefined) return null;
    if (hit) parts.push(hit);
  }
  return parts.length ? parts.join("") : null;
}

/** URL 尾段 → 中文动作词（install→安装、enable→启用…）。
 *
 * 仅返回可完整汉化的结果；纯数字主键 / UUID / 未识别词一律返回 null，
 * 由调用方决定省略——保证英文路由词不上屏。
 */
export function urlTailLabel(url: string | undefined): string | null {
  if (!url) return null;
  const seg = decodeURIComponent((url.split("?")[0] ?? "").split("/").filter(Boolean).pop() ?? "");
  if (!seg || /^\d+$/.test(seg) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(seg)) return null;
  const lower = seg.toLowerCase();
  if (ROUTE_ONLY_LABELS[lower]) return ROUTE_ONLY_LABELS[lower];
  return autoLabel(seg);
}

/** 查询参数 JSON → 「中文名=值」摘要（仅保留可识别参数，最多 2 组；无可识别项返回 null）。 */
export function queryParamText(paramsText: string | undefined): string | null {
  if (!paramsText || paramsText === "{}") return null;
  try {
    const q = JSON.parse(paramsText) as Record<string, unknown>;
    const pairs: string[] = [];
    for (const [k, v] of Object.entries(q)) {
      if (pairs.length >= 2) break;
      const label = QUERY_PARAM_LABELS[k] ?? GENERIC_FIELD_LABELS[k] ?? autoLabel(k);
      if (!label) continue; // 未识别的参数名不上屏
      pairs.push(`${label}=${maskValue(k, String(v))}`);
    }
    return pairs.length ? pairs.join(" ") : null;
  } catch {
    return null;
  }
}

/** 表名 → 中文名（TABLE_LABELS 未命中时按前缀剥离+分词汉化，最终兜底「数据表」）。 */
export function tableLabelSafe(table: string): string {
  if (TABLE_LABELS[table]) return TABLE_LABELS[table];
  const stripped = table.replace(/^(sys|base|map|knl|tsk|cab|dev)_/, "");
  return autoLabel(stripped) ?? "数据表";
}

export function fieldLabel(table: string, field: string): string {
  const override = TABLE_FIELD_OVERRIDES[table]?.[field];
  if (override) return override;
  if (GENERIC_FIELD_LABELS[field]) return GENERIC_FIELD_LABELS[field];
  // 不回退英文原名：分词自动汉化，仍失败归并为通用占位
  return autoLabel(field) ?? "其他字段";
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
        tableLabel: tableLabelSafe(table),
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

/** 任意 JSON 的字段名汉化 + 敏感值脱敏（详情「提交内容」等兜底视图用）。
 *
 * - 键名经 fieldLabel 汉化（未知键归并「其他字段」，重名自动加序号）；
 * - 字符串值按 SENSITIVE_DISPLAY/maskValue 兜底脱敏；
 * - 数组与嵌套对象递归处理。
 */
export function localizeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => localizeJson(v));
  const out: Record<string, unknown> = {};
  const dupCount = new Map<string, number>();
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    let label = fieldLabel("", k);
    if (label in out) {
      const n = (dupCount.get(label) ?? 1) + 1;
      dupCount.set(label, n);
      label = `${label} ${n}`;
    }
    out[label] = typeof v === "string" ? maskValue(k, v) : localizeJson(v);
  }
  return out;
}
