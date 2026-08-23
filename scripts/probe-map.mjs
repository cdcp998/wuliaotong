import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9224;
const BASE = "https://localhost:5174";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.ready = new Promise((r) => { ws.onopen = r; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
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
  const profile = join(tmpdir(), `wlt-probe-${Date.now()}`);
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
  await cdp.send("Page.navigate", { url: BASE + "/cable/map" });
  await sleep(3500);
  const diag = await cdp.eval(`JSON.stringify((() => {
    const sel = (s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); return { sh: el.scrollHeight, ch: el.clientHeight, oh: el.offsetHeight, ov: cs.overflow, ovy: cs.overflowY, h: cs.height }; };
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.bottom > 806 || (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && ['auto','scroll'].includes(getComputedStyle(el).overflowY))) {
        bad.push({ tag: el.tagName, cls: (el.className?.toString?.() ?? '').slice(0, 60), bottom: Math.round(r.bottom), sh: el.scrollHeight, ch: el.clientHeight, ovy: getComputedStyle(el).overflowY });
      }
    }
    return {
      winInner: window.innerHeight,
      docSH: document.documentElement.scrollHeight,
      docCH: document.documentElement.clientHeight,
      content: sel('.ant-layout-content'),
      siderMenu: sel('.ant-layout-sider .ant-menu'),
      bad: bad.slice(0, 12),
    };
  })())`);
  console.log(diag);
  cdp.ws.close(); chrome.kill();
}
main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
