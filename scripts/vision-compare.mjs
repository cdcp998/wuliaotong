/** 视觉核验：OP 设计基准图 vs 实机截图，交给 deepseek-v4-flash-vision-exp（hohai 代理）比对。
 * 用法：node scripts/vision-compare.mjs
 * 输出：AI开发文档/design-ref/compare_*.md + 控制台打印
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CRED = "C:/Users/CDCP/.dsh/.credentials.yaml";
const OUT = "G:/wuliaotong_dev/AI开发文档/design-ref";
const BASE = "https://api.hohai.eu.org/v1";
const MODEL = "deepseek-v4-flash-vision-exp";

const credRaw = readFileSync(CRED, "utf8");
const m = credRaw.match(/HOHAI_API_KEY\s*:\s*(\S+)/);
if (!m) throw new Error("HOHAI_API_KEY not found in .credentials.yaml");
const API_KEY = m[1];

const PAIRS = [
  {
    name: "dashboard",
    design: `${OUT}/j_dashboard.jpg`,
    app: `${OUT}/a_dashboard.jpg`,
    title: "统计面板（设计页 13）",
    checklist: [
      "页头：标题+副标题，右侧 3 个白底描边动作按钮（新建采购入库/领用审计/新建盘点）+刷新",
      "4 张统计卡：彩色大数字在上、灰标签在下（今日入库/今日出库/库存预警/待审计领用单）",
      "近7日趋势卡：图例胶囊、双柱（蓝入库/浅青出库）",
      "待办清单卡：浅底圆角行 + 彩色圆点 + 数量",
      "底部 5 张快捷入口卡（图标灰底+文字）",
    ],
  },
  {
    name: "map",
    design: `${OUT}/j_map.jpg`,
    app: `${OUT}/a_map.jpg`,
    title: "地图工作台（设计页 46）",
    checklist: [
      "地图全工作区：无页头、无内边距、无左侧面板",
      "左上图源 pill；右上工具栏（位置/测距/图层/刷新/标记 小图标+小文字）",
      "图层下拉挂工具栏下方",
      "左下故障导航 pill + 图例 pill；右下 缩放+/- 与指北",
      "地图铺满、无白边空边",
    ],
  },
  {
    name: "menus",
    design: `${OUT}/j_menus.jpg`,
    app: `${OUT}/a_menus.jpg`,
    title: "导航管理（设计页 52）",
    checklist: [
      "页头：标题+副标题+右侧「新建顶级分组」主按钮",
      "两栏：左菜单树卡 + 右「侧边栏预览」卡（250px）",
      "树行：浅底圆角，名称+胶囊+行内 ＋✎🗑",
      "预览盒：浅底、无权限/隐藏灰化",
      "无多余的第三栏",
    ],
  },
  {
    name: "users",
    design: `${OUT}/j_users.jpg`,
    app: `${OUT}/a_users.jpg`,
    title: "用户管理（设计页 34，普通页代表）",
    checklist: [
      "满宽平铺（无 maxWidth 居中）",
      "侧边栏：白底、Logo、搜索导航、全部收缩、分组展开、选中品牌浅底",
      "顶栏：折叠按钮、面包屑、全局搜索、铃铛、用户 chip",
      "表格：浅色表头、胶囊状态、圆角容器",
    ],
  },
  {
    name: "suppliers",
    design: `${OUT}/j_suppliers.jpg`,
    app: `${OUT}/a_suppliers.jpg`,
    title: "供应商管理（设计页 15）",
    checklist: [
      "页头：标题+副题「供应商档案：编码自动生成、简称归一（自动合并重复供应商）、采购价关联」+右侧 Excel 导入/导出（白底描边）/新增供应商（主按钮）",
      "筛选条：搜索框 300 浅底（供应商名称/编码/联系人）+ 状态下拉 160 + 右侧「共 N 家 · 启用 N」",
      "表格卡：列 供应商(含待合并胶囊)/编码/联系人/电话/最近供货/状态/操作",
    ],
  },
  {
    name: "plans",
    design: `${OUT}/j_plans.jpg`,
    app: `${OUT}/a_plans.jpg`,
    title: "采购计划单（设计页 18）",
    checklist: [
      "页头：标题+副题「计划 → 材料入库（送货单图片最多 10 张）闭环；状态：草稿/已提交/部分入库/已完成/作废」+右侧「新建计划」主按钮",
      "筛选条：搜索 300（计划单号/材料）+ 状态 170 +「共 N 张」",
      "表格列：计划单(品牌蓝加粗)/编制人/材料/数量/已入库(绿)/申请日期(MM-DD)/状态胶囊/操作(入库·详情链接)",
    ],
  },
  {
    name: "purchasein",
    design: `${OUT}/j_purchasein.jpg`,
    app: `${OUT}/a_purchasein.jpg`,
    title: "材料入库（设计页 19）",
    checklist: [
      "页头：标题+副题「采购入库单：表头（供应商/日期/备注）+ 明细（扫码/OCR 预填、移动加权成本、历史采购价提示）」+右侧「送货单 OCR 识别」白底描边 +「新增单据」主按钮",
      "新建弹窗内表头为 Field/Value 字段块（11px 灰标签 + 34 高 #F6F8FE 值框），图上方有明细表（材料/分类/单位/数量/单价/金额/库位/操作）与合计/添加明细",
    ],
  },
  {
    name: "warehouses",
    design: `${OUT}/j_warehouses.jpg`,
    app: `${OUT}/a_warehouses.jpg`,
    title: "仓库与货架（设计页 17）",
    checklist: [
      "页头：标题+副题「仓库 / 货架 / 库位三级管理：库位编码自动生成、2D 分层货架图、按单位过滤」+右侧「新增货架」白底描边 +「新增仓库」主按钮",
      "左 300px 白卡「仓库列表」（行：名称+编码+▸，选中 #EAEFFF 品牌蓝）；右侧筛选条（搜索库位/材料 + 「N 货架 · M 库位」胶囊）+ 分层货架图（第 N 层 + 库位格 64px 卡片）",
    ],
  },
  {
    name: "historyprice",
    design: `${OUT}/j_historyprice.jpg`,
    app: `${OUT}/a_historyprice.jpg`,
    title: "历史价格管理（设计页 21）",
    checklist: [
      "页头：标题+副题「按 材料 × 供应商 查看历史采购价，入库时自动提示涨跌（移动加权成本）」+右侧「导出」主按钮",
      "筛选条：搜索 300（材料/供应商）+ 全部供应商 180 + 近 30 天 180 +「共 N 条记录」",
      "表格列：材料(名称+编码)/供应商/单价(¥加粗)/涨跌胶囊(红涨/绿跌/持平)/单据/日期",
    ],
  },
  {
    name: "transfers",
    design: `${OUT}/j_transfers.jpg`,
    app: `${OUT}/a_transfers.jpg`,
    title: "库存调拨（设计页 22）",
    checklist: [
      "页头：标题+副题「仓库/库位间移动库存：同仓即时生效；跨仓需审核（统一库存事务防超调）」+右侧「新建调拨」主按钮",
      "筛选条：搜索 300（单号/材料/仓库）+ 全部状态 170 +「共 N 条」",
      "表格列：单号(品牌蓝)/材料/数量/调出/调入/状态胶囊(待审核橙/已完成绿/已驳回红)/审计人/日期",
    ],
  },
  {
    name: "otherio",
    design: `${OUT}/j_otherio.jpg`,
    app: `${OUT}/a_otherio.jpg`,
    title: "其他出入库（设计页 23）",
    checklist: [
      "页头：标题+副题「非采购入库/非领用出库的库存变动（报损/调拨外借/借出归还/工程退料等）」+右侧「新增出库」白底描边 +「新增入库」主按钮",
      "筛选条：搜索 300（单号/材料/原因）+ 全部类型 + 全部状态 +「共 N 条」",
      "表格列：单号/类型胶囊(出=红/入=绿)/材料/数量/原因备注/状态/经办人/日期",
    ],
  },
  {
    name: "taskboard",
    design: `${OUT}/j_taskboard.jpg`,
    app: `${OUT}/a_taskboard.jpg`,
    title: "任务看板（设计页 44）",
    checklist: [
      "页头：标题「维修任务看板」+副题「7 状态列拖拽流转；卡片：优先/单号/负责人/时间；看板 ⇄ 列表视图切换」+右侧「切换列表视图」白底描边 +「新建任务」主按钮",
      "看板：7 列（白底圆角列头：圆点+名称+数量），卡片浅底 #F6F8FE：优先+标题、描述、状态胶囊+时间",
    ],
  },
  {
    name: "tasklist",
    design: `${OUT}/j_tasklist.jpg`,
    app: `${OUT}/a_tasklist.jpg`,
    title: "任务列表（设计页 45）",
    checklist: [
      "页头：标题「维修任务列表」+副题「全量任务：状态筛选 / 优先 / 负责人 / 排期；记录、知识推荐、验收与关闭」+右侧「切换看板视图」白底描边 +「新建任务」主按钮",
      "筛选条：搜索 300（任务单号/内容）+ 全部状态 160 +「共 N 条」",
      "表格列：任务(标题+#单号)/优先胶囊/负责人/状态胶囊/排期/来源/操作",
    ],
  },
  {
    name: "mapcache",
    design: `${OUT}/j_mapcache.jpg`,
    app: `${OUT}/a_mapcache.jpg`,
    title: "地图缓存管理（设计页 47）",
    checklist: [
      "页头：标题+副题（按地图源/区域管理瓦片缓存）+右侧「刷新/图源管理」白底描边 +「生成缓存」主按钮",
      "统计卡×4（区域/瓦片/成功+失败/失败）+ 全局生成进度条（待/成功/失败胶囊）+ 表格（区域/模式/级别/瓦片/磁盘/状态/进度/操作）",
    ],
  },
  {
    name: "logs",
    design: `${OUT}/j_logs.jpg`,
    app: `${OUT}/a_logs.jpg`,
    title: "操作日志（设计页 37）",
    checklist: [
      "页头：标题+副题「全量审计：谁/何时/做了什么（中文动作），支持按用户/模块/时间筛选与导出」+右侧「导出」主按钮",
      "筛选条：搜索 300（操作人/内容）+ 全部模块 + 全部方法 + 日期范围 + 查询按钮（白底描边）+「共 N 条」",
      "表格列：时间(MM-DD HH:mm:ss)/操作人/模块胶囊/动作/详情/IP；点击行开详情",
    ],
  },
  {
    name: "faults",
    design: `${OUT}/j_faults.jpg`,
    app: `${OUT}/a_faults.jpg`,
    title: "故障管理（设计页 43，故障上报改弹窗）",
    checklist: [
      "页头：标题+副题+右侧「故障上报」主按钮（含刷新可选）",
      "状态角标 Tabs（全部/待处理/处理中/待验证/已修复/已关闭）+ 严重度筛选",
      "表格满宽（故障/类型/严重度/位置/状态/上报时间/操作）；点「故障上报」为弹窗（非右侧常驻面板）",
    ],
  },
];

function b64(path) {
  return readFileSync(path).toString("base64");
}

async function chat(messages) {
  // 先试 OpenAI chat/completions 兼容
  let r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 4000 }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`chat/completions ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  writeFileSync(`${OUT}/_raw_${lastName}.json`, JSON.stringify(j, null, 2).slice(0, 200000), "utf8");
  const c = j.choices?.[0]?.message?.content ?? "";
  const rc = j.choices?.[0]?.message?.reasoning_content ?? "";
  return c || rc || "(empty content)";
}

const only = process.argv.slice(2);
let lastName = "";
const results = [];
for (const p of PAIRS.filter((p) => !only.length || only.includes(p.name))) {
  lastName = p.name;
  const text = `你是严格的 UI 视觉比对员。图1 是 OpenPencil 设计基准图，图2 是同页面的实际实现截图（1440 视口实机）。请逐项对照下列检查点，指出图2 与图1 的**可见差异**（布局位置/缺失元素/多余元素/样式明显不符），并给出修复建议。检查点：\n${p.checklist.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n输出格式：\n【符合】\n【不符合】逐条（定位到屏幕区域）\n【建议】按优先级`;
  const msg = [
    {
      role: "user",
      content: [
        { type: "text", text },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64(p.design)}` } },
        { type: "text", text: "图2（实际实现）：" },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64(p.app)}` } },
      ],
    },
  ];
  console.log(`\n========== ${p.title} ==========`);
  let out = "";
  try {
    out = await chat(msg);
  } catch (e) {
    out = `[vision compare failed] ${e.message}`;
  }
  console.log(out);
  writeFileSync(`${OUT}/compare_${p.name}.md`, `# ${p.title} —— 设计基准 vs 实机截图 视觉比对\n\n${out}\n`, "utf8");
  results.push({ name: p.name, ok: !out.startsWith("[vision compare failed]") });
}

console.log("\nDONE", JSON.stringify(results));
