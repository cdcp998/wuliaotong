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
