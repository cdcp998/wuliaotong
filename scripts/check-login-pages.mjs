/** 快速判定：给定截图是否为登录页（用于定位批量截图拍到登录页的问题）。
 * 用法：node scripts/check-login-pages.mjs [name...]   不带参数=全部 22 页 a_*.jpg
 * 输出：控制台每页 登录/内容 + EOF
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "G:/wuliaotong_dev/AI开发文档/design-ref";
const CRED = "C:/Users/CDCP/.dsh/.credentials.yaml";
const BASE = "https://api.hohai.eu.org/v1";
const MODEL = "deepseek-v4-flash-vision-exp";

const credRaw = readFileSync(CRED, "utf8");
const m = credRaw.match(/HOHAI_API_KEY\s*:\s*(\S+)/);
if (!m) throw new Error("HOHAI_API_KEY not found");
const API_KEY = m[1];

function b64(p) { return readFileSync(p).toString("base64"); }

async function chat(messages) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 400 }),
  });
  if (!r.ok) throw new Error(`chat ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const c = j.choices?.[0]?.message?.content ?? "";
  return c.trim();
}

const only = process.argv.slice(2);
const appFiles = readdirSync(OUT).filter((f) => f.startsWith("a_") && f.endsWith(".jpg")).sort();
const targets = only.length
  ? only.map((n) => `a_${n}.jpg`).filter((f) => appFiles.includes(f))
  : appFiles;

let bad = 0;
for (const f of targets) {
  const ans = await chat([
    { role: "user", content: [
      { type: "text", text: "这是一张桌面端 Web 应用截图。请只回答一个词：如果它是登录/登录页（中心登录卡片、账号密码输入框、登录按钮），回答「登录」；如果它是已经登录后的业务页面（有侧边导航、顶栏、表格/卡片等），回答「内容」。其它情况回答「未知」。" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64(join(OUT, f))}` } },
    ] },
  ]);
  const isLogin = /登录/.test(ans);
  if (isLogin) bad++;
  console.log(`${isLogin ? "[登录]" : "[内容]"}  ${f}  ->  ${ans}`);
}
console.log(`\nDONE  login: ${bad}/${targets.length}`);
