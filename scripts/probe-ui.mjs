/** UI 核验探针（DOM 客观取数，配合 vision-compare 使用）：
 * 用法：node scripts/probe-ui.mjs
 * 检查：Dashboard 统计卡颜色/刷新按钮/趋势双柱/快捷入口一行；Menus 树行浅底/页头按钮；Map 铺满。
 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9225;
const BASE = "https://localhost:5174";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.ready = new Promise((r) => { ws.onopen = r; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      this.ready.then(() => {
        const id = ++this.id;
        this.pending.set(id, { res, rej });
        this.ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error("timeout " + method)); } }, 15000);
      });
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
}

async function main() {
  const profile = join(tmpdir(), `wlt-probe-ui-${Date.now()}`);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--ignore-certificate-errors", "--window-size=1440,900", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* retry */ } await sleep(500); }
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + "/login")}`, { method: "PUT" })).json();
  const cdp = new CDP(new WebSocket(tab.webSocketDebuggerUrl));
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await sleep(2500);
  await cdp.eval(`(() => {
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
    set(document.querySelector('input[placeholder="账号 / 用户名"]'), 'admin');
    set(document.querySelector('input[placeholder="密码"]'), 'admin123');
    document.querySelector('button[type="submit"]').click();
  })()`);
  await sleep(3500);

  // ---- Dashboard ----
  await cdp.send("Page.navigate", { url: BASE + "/dashboard" });
  await sleep(3500);
  const dash = await cdp.eval(`JSON.stringify((() => {
    const out = {};
    // 页头动作按钮
    const h2 = [...document.querySelectorAll("h2")].map(e => e.textContent);
    out.h2 = h2;
    const btns = [...document.querySelectorAll(".ant-layout-content button")].map(b => (b.textContent || "").trim()).filter(Boolean);
    out.headerBtns = btns.slice(0, 8);
    out.refreshBtn = !!document.querySelector('.ant-layout-content button[aria-label="刷新"]');
    // 统计卡数字颜色
    out.statNumbers = [...document.querySelectorAll(".ant-layout-content .wlt-glass")].slice(0, 4).map(c => {
      const n = c.querySelector("div");
      const cs = getComputedStyle(n);
      return { text: n.textContent, color: cs.color, fs: cs.fontSize };
    });
    // 趋势双柱（svg 内 rect/path 填充色统计）
    const svg = document.querySelector(".ant-layout-content svg");
    if (svg) {
      const fills = {};
      for (const p of svg.querySelectorAll("rect,path")) {
        const f = (p.getAttribute("fill") || p.style.fill || "").toUpperCase();
        if (f) fills[f] = (fills[f] || 0) + 1;
      }
      out.trendFills = fills;
    }
    // 快捷入口：5 张卡是否同顶一行
    const q = [...document.querySelectorAll(".wlt-glass")].slice(-5);
    out.quickCount = q.length;
    out.quickRects = q.map(e => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) }; });
    return out;
  })())`);
  console.log("== dashboard ==");
  console.log(JSON.stringify(JSON.parse(dash), null, 1));

  // ---- Menus ----
  await cdp.send("Page.navigate", { url: BASE + "/system/menus" });
  await sleep(3500);
  const menus = await cdp.eval(`JSON.stringify((() => {
    const out = {};
    const headerBtns = [...document.querySelectorAll(".ant-layout-content button")].map(b => (b.textContent || "").trim()).filter(Boolean);
    out.headerBtns = headerBtns.slice(0, 6);
    // 树行背景
    const row = document.querySelector('.wlt-menu-tree .ant-tree-treenode');
    if (row) {
      const cs = getComputedStyle(row);
      out.treeRow = { bg: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding };
      const wrap = row.querySelector(".ant-tree-node-content-wrapper");
      if (wrap) { const cw = getComputedStyle(wrap); out.treeWrap = { bg: cw.backgroundColor, radius: cw.borderRadius }; }
    }
    // 树行实际 DOM：全部后代类名 + 背景
    const first = document.querySelector(".wlt-menu-tree .ant-tree-treenode");
    out.treeDom = first ? [...first.querySelectorAll("*")].slice(0, 14).map((el) => {
      const cs = getComputedStyle(el);
      return { cls: (el.className?.toString?.() ?? "").slice(0, 60), bg: cs.backgroundColor, radius: cs.borderRadius };
    }) : null;
    out.treeHtml = (document.querySelector(".wlt-menu-tree")?.outerHTML ?? "").slice(0, 1600);
    // 可见行（跳过隐藏测量节点）的 content-wrapper 计算样式
    const visibleRows = [...document.querySelectorAll(".wlt-menu-tree .ant-tree-treenode")].filter((r) => r.getAttribute("aria-hidden") !== "true");
    const wrap2 = visibleRows[0]?.querySelector(".ant-tree-node-content-wrapper");
    if (wrap2) { const cw = getComputedStyle(wrap2); out.visibleWrap = { bg: cw.backgroundColor, radius: cw.borderRadius, padding: cw.padding }; }
    out.visibleRowCount = visibleRows.length;
    out.expandedCount = visibleRows.filter((r) => r.getAttribute("aria-expanded") === "true").length;
    out.treeSamples = [...document.querySelectorAll(".wlt-menu-tree .ant-tree-treenode")].slice(0, 3).map((r) => {
      const chain = [];
      let el = r;
      for (let i = 0; i < 4 && el; i++) { chain.push((el.className?.toString?.() ?? "").slice(0, 70)); el = el.querySelector(":scope > div"); }
      return chain;
    });
    // 预览卡头：是否还有 Tag
    out.previewTags = [...document.querySelectorAll(".ant-layout-content .ant-tag")].map(t => t.textContent).filter(t => /管理员|当前账号/.test(t));
    const boxes = [...document.querySelectorAll(".wlt-glass")];
    out.glassCount = boxes.length;
    return out;
  })())`);
  console.log("== menus ==");
  console.log(JSON.stringify(JSON.parse(menus), null, 1));

  // ---- Map ----
  await cdp.send("Page.navigate", { url: BASE + "/cable/map" });
  await sleep(4500);
  const map = await cdp.eval(`JSON.stringify((() => {
    const out = {};
    const content = document.querySelector(".ant-layout-content");
    const cr = content?.getBoundingClientRect();
    if (cr) out.contentRect = { w: Math.round(cr.width), h: Math.round(cr.height), top: Math.round(cr.top), left: Math.round(cr.left) };
    // 找地图容器（.leaflet-container）
    const leaf = document.querySelector(".leaflet-container");
    if (leaf) { const r = leaf.getBoundingClientRect(); out.mapRect = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom) }; }
    // 工作台内是否还有页头 h2 / 内边距
    const work = document.querySelector(".leaflet-container")?.parentElement?.parentElement;
    out.pagePad = work ? getComputedStyle(work).padding : null;
    // 右下自定缩放 & 指北
    out.zoomBtns = [...document.querySelectorAll(".ant-layout-content button")].map(b => (b.textContent || b.getAttribute("aria-label") || "").trim()).filter(Boolean).slice(0, 10);
    return out;
  })())`);
  console.log("== map ==");
  console.log(JSON.stringify(JSON.parse(map), null, 1));

  cdp.ws.close();
  chrome.kill();
  try { require("node:fs").rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
main().then(() => { console.log("DONE"); process.exit(0); }).catch((e) => { console.error("FAIL", e.message); process.exit(1); });
