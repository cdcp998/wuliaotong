/** 物料通手机端 UI 实机核验：Chrome headless + CDP（390×844 移动仿真）。
 * 用法：node scripts/verify-ui-mobile.cdp.mjs [--port 9226] [--base https://localhost:5175]
 * 步骤：起无头 Chrome → 登录页截图 → admin/admin123 登录 → 逐页截图（OP 六页重构核验）。
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
const PORT = Number(arg("--port", "9226"));
const BASE = arg("--base", "https://localhost:5175");
const OUT = arg("--out", "G:/wuliaotong_dev/AI开发文档/screenshots");
const PAGES = ["/mine", "/notifications", "/warehouses", "/tasks/mine", "/cable/map"];
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
        const list = (this.waiters.get(m.method) ?? []).map((w) => w(m.params)).filter(Boolean);
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
      this.waiters.set(method, [...(this.waiters.get(method) ?? []), (p) => { clearTimeout(t); resolve(p); }]);
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  }
  async shot(file) {
    const s = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(s.data, "base64"));
    console.log("saved", file);
  }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

async function main() {
  const profile = join(tmpdir(), `wlt-ui-m-${Date.now()}`);
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--ignore-certificate-errors",
    "--window-size=390,844",
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });
  chrome.on("error", (e) => console.error("chrome spawn failed:", e.message));

  let version = null;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { version = await r.json(); break; }
    } catch { /* retry */ }
    await sleep(500);
  }
  if (!version) throw new Error("Chrome DevTools 端口未就绪");

  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + "/login")}`, { method: "PUT" })).json();
  const cdp = new CDP(new WebSocket(tab.webSocketDebuggerUrl));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  // iPhone 尺寸移动仿真（OP 手机稿画布 390×844）
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.once("Page.loadEventFired", 15000).catch(() => null);
  await sleep(3000);

  mkdirSync(OUT, { recursive: true });
  // 登录页（M20 重构）截图
  await cdp.shot(join(OUT, "mobile_390_login.png"));

  // 登录 admin/admin123：无头环境 antd-mobile Input 的合成事件链不稳定，
  // 改走同源 API 登录（Session Cookie 与 UI 登录完全一致），仅用于建立会话后截图核验页面。
  const loginR = await cdp.eval(`
    fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', captcha_id: '', captcha_code: '', remember: true }),
    }).then(r => r.status)
  `);
  console.log("api-login status:", loginR);
  await sleep(500);
  const loaded0 = cdp.once("Page.loadEventFired", 15000);
  await cdp.send("Runtime.evaluate", { expression: "location.assign('/')" });
  await loaded0;
  await sleep(3000);
  let path = await cdp.eval("location.pathname");
  console.log("after-login path:", path);
  if (path !== "/") throw new Error("登录失败，停在 " + path);

  for (const p of PAGES) {
    const loaded = cdp.once("Page.loadEventFired", 12000);
    await cdp.send("Page.navigate", { url: BASE + p });
    await loaded;
    await sleep(3500);
    await cdp.shot(join(OUT, `mobile_390_${p.replaceAll("/", "_").replace(/^_/, "")}.png`));
  }
  // 平板断点抽检：768px 下「我的」窗口化居中
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true });
  const loaded2 = cdp.once("Page.loadEventFired", 12000);
  await cdp.send("Page.navigate", { url: BASE + "/mine" });
  await loaded2;
  await sleep(2500);
  await cdp.shot(join(OUT, "mobile_768_mine.png"));

  cdp.close();
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); } catch { /* 临时目录清理失败不影响结果 */ }
}

main().then(() => { console.log("DONE"); process.exit(0); }).catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
