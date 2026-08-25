/** 「关于」页验证：登录 → /system/settings?tab=about → 校验 tab 排序与版本信息 → 截图。 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const PORT = 9230;
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
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
  }
  send(method, params = {}) {
    return new Promise(async (resolve, reject) => {
      await this.ready;
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("timeout")); } }, 15000);
    });
  }
  async eval(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r?.result?.value; }
}

async function main() {
  const profile = join(tmpdir(), `wlt-about-${Date.now()}`);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--ignore-certificate-errors", "--window-size=1440,900", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* retry */ } await sleep(500); }
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + "/login")}`, { method: "PUT" })).json();
  const cdp = new CDP(new WebSocket(tab.webSocketDebuggerUrl));
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await sleep(2500);
  await cdp.eval(`(() => {
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
    set(document.querySelector('input[placeholder="账号 / 用户名"]'), 'admin');
    set(document.querySelector('input[placeholder="密码"]'), 'admin123');
    document.querySelector('button[type="submit"]').click();
  })()`);
  await sleep(3000);
  await cdp.send("Page.navigate", { url: BASE + "/system/settings?tab=about" });
  await sleep(3000);
  const info = await cdp.eval(`JSON.stringify({
    tabs: [...document.querySelectorAll('.ant-tabs-tab')].map(t=>t.textContent.trim()),
    active: document.querySelector('.ant-tabs-tab-active')?.textContent?.trim(),
    versionCard: [...document.querySelectorAll('div')].some(d=>d.textContent==='系统版本号'),
    repoLink: !!document.querySelector('a[href*="github.com/cdcp998/wuliaotong"]'),
    ossRows: document.querySelectorAll('table tbody tr').length,
  })`);
  console.log(info);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("G:/wuliaotong_dev/AI开发文档/screenshots/b5_about.png", Buffer.from(shot.data, "base64"));
  console.log("saved b5_about.png");
  cdp.ws.close(); chrome.kill();
  process.exit(0);
}
main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
