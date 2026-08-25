/** 入口选择页探针：打开 / ，记录各时刻 location + 截图，验证 3 秒倒计时自动跳转。
 * 用法：node scripts/probe-entry.mjs
 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const PORT = 9227;
const BASE = "https://localhost:5174";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    this.ready = new Promise((r) => { ws.onopen = r; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) this.events.push(m);
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
  async eval(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r?.result?.value; }
}

async function main() {
  const profile = join(tmpdir(), `wlt-entry-${Date.now()}`);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--ignore-certificate-errors", "--window-size=1440,900", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* retry */ } await sleep(500); }
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + "/")}`, { method: "PUT" })).json();
  const cdp = new CDP(new WebSocket(tab.webSocketDebuggerUrl));
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await sleep(1200);
  const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("G:/wuliaotong_dev/AI开发文档/screenshots/probe_entry_t1s.png", Buffer.from(shot1.data, "base64"));
  const ui1 = await cdp.eval(`JSON.stringify({ path: location.pathname, cards: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean), hasCountdown: document.body.textContent.includes('后自动进入') })`);
  console.log("t≈1.2s:", ui1);
  await sleep(1300);
  console.log("t≈2.5s:", await cdp.eval("location.pathname"));
  await sleep(1500);
  const ui3 = await cdp.eval(`JSON.stringify({ path: location.pathname, welcome: !!document.querySelector('input[placeholder="账号 / 用户名"]') })`);
  console.log("t≈4s:", ui3);
  await sleep(800);
  const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("G:/wuliaotong_dev/AI开发文档/screenshots/probe_login.png", Buffer.from(shot2.data, "base64"));
  console.log("saved screenshots/probe_entry_t1s.png + probe_login.png");
  cdp.ws.close(); chrome.kill();
}
main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
