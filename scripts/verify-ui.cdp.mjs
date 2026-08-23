/** 物料通桌面端 UI 实机核验：Chrome headless + CDP。
 * 用法：node scripts/verify-ui.cdp.mjs [--port 9223] [--base https://localhost:5174] [--out <dir>]
 * 依赖：本机已装 Chrome；Node ≥ 22（原生 WebSocket/fetch）。
 * 步骤：起无头 Chrome → 打开登录页 → admin/admin123 登录 → 逐页截图。
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = Number(arg("--port", "9223"));
const BASE = arg("--base", "https://localhost:5174");
const OUT = arg("--out", "G:/wuliaotong_dev/AI开发文档/screenshots");
const PAGES = ["/dashboard", "/system/menus", "/cable/map", "/system/users"];
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.waiters = new Map();
    this.ready = new Promise((resolve) => { ws.onopen = () => resolve(); });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) {
        const list = this.waiters.get(m.method) ?? [];
        this.waiters.delete(m.method);
        for (const w of list) w(m.params);
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 15000);
    });
  }
  once(method, timeout = 15000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeout);
      const w = (p) => { clearTimeout(t); resolve(p); };
      this.waiters.set(method, [...(this.waiters.get(method) ?? []), w]);
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function main() {
  const profile = join(tmpdir(), `wlt-ui-${Date.now()}`);
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--ignore-certificate-errors",
    "--window-size=1440,900",
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });
  chrome.on("error", (e) => console.error("chrome spawn failed:", e.message));

  // 等调试端口就绪
  let version = null;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { version = await r.json(); break; }
    } catch { /* retry */ }
    await sleep(500);
  }
  if (!version) throw new Error("Chrome DevTools 端口未就绪");

  // 开新标签
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + "/login")}`, { method: "PUT" })).json();
  const cdp = new CDP(new WebSocket(tab.webSocketDebuggerUrl));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.once("Page.loadEventFired", 15000).catch(() => null);
  await sleep(2500);

  // 登录 admin/admin123
  const submitR = await cdp.eval(`
    (() => {
      const set = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        s.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const u = document.querySelector('input[placeholder="账号 / 用户名"]');
      const p = document.querySelector('input[placeholder="密码"]');
      if (!u || !p) return 'inputs-missing';
      set(u, 'admin');
      set(p, 'admin123');
      const btn = document.querySelector('button[type="submit"]');
      if (!btn) return 'submit-missing';
      btn.click();
      return 'submitted';
    })()
  `);
  console.log("submit:", submitR);
  await sleep(3500);
  let path = await cdp.eval("location.pathname");
  if (path !== "/dashboard") {
    // 诊断：是否有错误提示 / 验证码输入框
    const diag = await cdp.eval(`JSON.stringify({
      href: location.href,
      toast: [...document.querySelectorAll('.ant-message-notice-content')].map(e => e.textContent),
      captcha: !!document.querySelector('input[placeholder="4 位验证码"]'),
    })`);
    console.log("diag:", diag);
    await sleep(2500);
    path = await cdp.eval("location.pathname");
  }
  console.log("after-login path:", path);
  if (path !== "/dashboard") throw new Error("登录失败，停在 " + path);

  mkdirSync(OUT, { recursive: true });
  for (const p of PAGES) {
    const loaded = cdp.once("Page.loadEventFired", 12000);
    await cdp.send("Page.navigate", { url: BASE + p });
    await loaded;
    await sleep(3200);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT, `desktop_1440_${p.replaceAll("/", "_").replace(/^_/, "")}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log("saved", file);
  }
  cdp.close();
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); } catch { /* 临时目录清理失败不影响结果 */ }
}

main().then(() => { console.log("DONE"); process.exit(0); }).catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
