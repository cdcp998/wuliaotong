/** 批量三探针：登录后逐页访问本轮改动页面，记录 console 错误并截图。
 * 用法：node scripts/probe-batch3.mjs
 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = 9228;
const BASE = "https://localhost:5174";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = "G:/wuliaotong_dev/AI开发文档/screenshots";
const PAGES = [
  ["/cable/cache", "b4_mapcache"],
  ["/system/logs", "b4_logs"],
  ["/llm-logs", "b4_ai_logs"],
  ["/system/settings?tab=backups", "b4_settings_backups"],
  ["/system/users", "b4_users"],
  ["/materials-data", "b4_materials"],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.waiters = new Map();
    this.ready = new Promise((r) => { ws.onopen = r; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        this.errors.push(m.params.args?.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
      }
    };
    this.errors = [];
  }
  send(method, params = {}) {
    return new Promise(async (resolve, reject) => {
      await this.ready;
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 15000);
    });
  }
  async eval(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r?.result?.value; }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = join(tmpdir(), `wlt-b3-${Date.now()}`);
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
  console.log("login:", await cdp.eval("location.pathname"));
  cdp.errors.length = 0;

  for (const [path, name] of PAGES) {
    cdp.errors.length = 0;
    await cdp.send("Page.navigate", { url: BASE + path });
    await sleep(3200);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
    const realPath = await cdp.eval("location.pathname + location.search");
    const errs = [...new Set(cdp.errors)].filter((e) => !e.includes("antd: Drawer") && !e.includes("Failed to load resource"));
    console.log(`${name}: ${realPath}${errs.length ? "  ERR: " + errs.join(" | ") : ""}`);
  }
  cdp.ws.close(); chrome.kill();
}
main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
