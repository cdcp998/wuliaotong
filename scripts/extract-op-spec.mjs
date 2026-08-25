/** 从 OpenPencil .op 文件提取指定页面的布局规格（文本节点 + 关键框架尺寸/配色）→ markdown。
 * 用法：node scripts/extract-op-spec.mjs <pageId>...  例：node scripts/extract-op-spec.mjs n676 n848
 * 输出：AI开发文档/design-ref/specs/<页面名>.md
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const OP = "G:/wuliaotong_dev/AI开发文档/OpenPencil设计稿/物料通UI全界面设计.op";
const OUT = "G:/wuliaotong_dev/AI开发文档/design-ref/specs";
const targets = process.argv.slice(2);
if (!targets.length) {
  console.error("usage: node scripts/extract-op-spec.mjs <pageId>...");
  process.exit(1);
}

const doc = JSON.parse(readFileSync(OP, "utf8"));
const pages = doc.pages ?? [];
const byId = new Map(pages.map((p) => [p.id, p]));

const hex = (c) => (c && c.color ? c.color : "");
const fillOf = (n) => (Array.isArray(n.fill) && n.fill[0]?.color) || "";
const padOf = (n) => (Array.isArray(n.padding) ? `p${n.padding.join("/")}` : n.padding ? `p${n.padding}` : "");
const num = (v) => (typeof v === "number" ? v : "");

function walk(node, path, lines) {
  const kind = node.type;
  if (kind === "text") {
    const color = fillOf(node);
    lines.push(`- [文本] ${path.join(" > ")} → 「${node.content ?? ""}」 ${node.fontSize ?? ""}px/${node.fontWeight ?? ""} ${color}`);
    return;
  }
  const name = node.name || "";
  const info = [kind === "frame" ? "框" : kind, name, node.layout || "", num(node.width), num(node.height),
    num(node.cornerRadius) ? `r${node.cornerRadius}` : "", fillOf(node) ? `bg#${fillOf(node)}` : "", padOf(node),
    node.gap ? `gap${node.gap}` : ""].filter(Boolean).join(" ");
  lines.push(`- ${info}`);
  for (const c of node.children ?? []) walk(c, [...path, name || node.id], lines);
}

mkdirSync(OUT, { recursive: true });
for (const id of targets) {
  const page = byId.get(id);
  if (!page) { console.error("page not found:", id); continue; }
  const lines = [];
  for (const c of page.children ?? []) walk(c, [page.name], lines);
  const md = `# ${page.name}（OP 规格提取）\n\n${lines.join("\n")}\n`;
  const file = join(OUT, `${page.name}.md`.replace(/[\\/:*?"<>|]/g, "_"));
  writeFileSync(file, md, "utf8");
  console.log("saved", file, `(${lines.length} nodes)`);
}
