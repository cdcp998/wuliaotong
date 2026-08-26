// 前端代码质量基线（Node stdlib 零依赖）：循环依赖 / 模块不稳定度 / 巨型文件热点。
//
// 用法：node scripts/fe_quality.mjs [--json out.json]
//
// 口径说明（自洽可复现）：
// - 图范围：frontend/apps/*/src 与 frontend/packages/*/src 内的 .ts/.tsx/.js/.jsx；
//   仅解析静态 import / export ... from / 动态 import() 中可解析为仓内文件的相对路径；
//   包名导入（antd/@wlt/shared 等）计为外部依赖，不入图。
// - 循环依赖：DFS 找回边，输出环路径。
// - 不稳定度（Martin I）：I = 扇出/(扇入+扇出)，仅统计仓内 src 边；
//   I 高且扇出高 = 易变候选；扇入高 = 枢纽文件，改动需回归下游。
// - 巨型文件：按行数排序的热点清单（复杂度细测留给 P1 引入 eslint complexity 规则）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FE = join(ROOT, "frontend");
const EXTS = [".ts", ".tsx", ".js", ".jsx"];
const SCAN_ROOTS = ["apps/desktop/src", "packages/shared/src"];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === "node_modules" || e === "__pycache__" || e === ".git") continue;
      walk(p, out);
    } else if (EXTS.some((x) => e.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  const tries = [base, ...EXTS.map((x) => base + x), ...EXTS.map((x) => join(base, "index" + x))];
  for (const t of tries) {
    try {
      if (statSync(t).isFile()) return t;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

const allFiles = SCAN_ROOTS.flatMap((r) => walk(join(FE, r)));
const fileSet = new Set(allFiles);
const rel = (p) => p.replace(FE + sep, "").replaceAll(sep, "/");

const IMPORT_RE = [
  /(?:^|\n)\s*import\s+(?:type\s+)?[\s\S]*?from\s*["']([^"']+)["']/g,
  /(?:^|\n)\s*export\s+(?:type\s+)?[\s\S]*?from\s*["']([^"']+)["']/g,
  /import\(\s*["']([^"']+)["']\s*\)/g,
  /(?:^|\n)\s*import\s*["']([^"']+)["']\s*;?/g,
];

const graph = new Map(); // file -> Set<file>
let unresolved = 0;
for (const f of allFiles) {
  const src = readFileSync(f, "utf8");
  const deps = new Set();
  for (const re of IMPORT_RE) {
    for (const m of src.matchAll(re)) {
      const target = resolveSpecifier(f, m[1]);
      if (target && target !== f) deps.add(target);
      else if (!target && m[1].startsWith(".")) unresolved++;
    }
  }
  graph.set(f, deps);
}

// ---- 循环依赖（DFS 回边，去重环集合）----
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = new Map(allFiles.map((f) => [f, WHITE]));
const cycles = [];
const path = [];
function dfs(u) {
  color.set(u, GRAY);
  path.push(u);
  for (const v of graph.get(u) ?? []) {
    if ((color.get(v) ?? WHITE) === GRAY) {
      const i = path.indexOf(v);
      cycles.push([...path.slice(i), v]);
    } else if (color.get(v) === WHITE) {
      dfs(v);
    }
  }
  path.pop();
  color.set(u, BLACK);
}
for (const f of allFiles) if (color.get(f) === WHITE) dfs(f);

// ---- 不稳定度 ----
const fanIn = new Map(), fanOut = new Map();
for (const [u, vs] of graph) {
  fanOut.set(u, vs.size);
  for (const v of vs) fanIn.set(v, (fanIn.get(v) ?? 0) + 1);
}
const nodes = [...new Set([...fanIn.keys(), ...fanOut.keys()])];
const inst = nodes
  .map((f) => {
    const fi = fanIn.get(f) ?? 0, fo = fanOut.get(f) ?? 0;
    return { file: rel(f), fanIn: fi, fanOut: fo, i: fi + fo ? +(fo / (fi + fo)).toFixed(2) : 0 };
  })
  .filter((x) => x.fanIn + x.fanOut > 0);
const volatile = inst.filter((x) => x.i >= 0.8 && x.fanOut >= 5).sort((a, b) => b.i - a.i || b.fanOut - a.fanOut);
const hubs = [...inst].sort((a, b) => b.fanIn - a.fanIn).slice(0, 10);

// ---- 巨型文件热点 ----
const loc = allFiles
  .map((f) => ({ file: rel(f), lines: readFileSync(f, "utf8").split("\n").length }))
  .sort((a, b) => b.lines - a.lines);

console.log(`扫描 ${allFiles.length} 个源文件（${SCAN_ROOTS.join(", ")}），相对导入未解析 ${unresolved} 处`);
console.log(`\n== 循环依赖 ==`);
console.log(`发现 ${cycles.length} 条环路径${cycles.length ? "（同一强连通分量可能报告多条）" : ""}`);
for (const c of cycles.slice(0, 10)) console.log("  环: " + c.map(rel).join(" -> "));
console.log(`\n== 不稳定度（${nodes.length} 个有依赖关系的文件）==`);
console.log(`I>=0.8 且扇出>=5 的「易变候选」：${volatile.length} 个；Top15：`);
for (const v of volatile.slice(0, 15)) console.log(`  I=${v.i.toFixed(2)} 扇入${String(v.fanIn).padStart(3)} 扇出${String(v.fanOut).padStart(3)}  ${v.file}`);
console.log("扇入 Top10（枢纽文件）：");
for (const h of hubs) console.log(`  扇入${String(h.fanIn).padStart(3)}  ${h.file}`);
console.log(`\n== 巨型文件 Top12（行数）==`);
for (const l of loc.slice(0, 12)) console.log(`  ${String(l.lines).padStart(6)} 行  ${l.file}`);

const jsonIdx = process.argv.indexOf("--json");
if (jsonIdx > -1 && process.argv[jsonIdx + 1]) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    process.argv[jsonIdx + 1],
    JSON.stringify({ scanned: allFiles.length, cycles: cycles.map((c) => c.map(rel)), instability: { volatile: volatile.slice(0, 60), hubs }, locTop: loc.slice(0, 30) }, null, 2),
  );
  console.log(`\nJSON 已写入 ${process.argv[jsonIdx + 1]}`);
}
