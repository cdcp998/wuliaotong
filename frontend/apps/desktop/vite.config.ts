import fs from "node:fs";
import { execSync, type ExecSyncOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// HTTPS 开发环境（本地 80 被业务占用；复用 backend/certs/dev 自签名证书）
// 路径基于本文件所在目录解析：apps/desktop → 项目根 → backend/certs/dev
// CI/无证书环境（如纯构建、clone 后未生成本地证书）自动跳过 https 配置，
// 避免 vite build 求值 server 配置时因缺证书文件报 ENOENT。
const CERT_DIR = "../../../backend/certs/dev";
const hasCerts =
  fs.existsSync(`${CERT_DIR}/key.pem`) && fs.existsSync(`${CERT_DIR}/cert.pem`);

// 唯一版本源为 backend/app/__init__.py 的 __version__；本包 package.json.version 与之保持
// 一致（scripts/check_version.py 强制校验）。构建时注入 __APP_VERSION__ 供前端展示，避免 UI 内硬编码。
const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8")) as { version: string };

// 构建信息（「关于」页展示）：git 短哈希作为构建号、当前版本最后提交日期作为发布日期。
// 非 git 环境（zip 分发/CI 隔离）优雅回退为 dev 标识。
const REPO_DIR = fileURLToPath(new URL("../../..", import.meta.url));
function gitBuildInfo(): { hash: string; released: string; builtAt: string } {
  try {
    const gitOpts: ExecSyncOptions = { cwd: REPO_DIR, stdio: ["pipe", "pipe", "ignore"] };
    const hash = execSync("git rev-parse --short HEAD", gitOpts).toString().trim();
    const released = execSync("git log -1 --format=%cs", gitOpts).toString().trim();
    return { hash, released, builtAt: new Date().toISOString().slice(0, 16).replace("T", " ") };
  } catch {
    return { hash: "dev", released: new Date().toISOString().slice(0, 10), builtAt: new Date().toISOString().slice(0, 16).replace("T", " ") };
  }
}
const buildInfo = gitBuildInfo();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
  // workspace 源码包不参与依赖预构建：@wlt/shared 改动即时 HMR（否则 dev server 用旧缓存，改动不生效）
  optimizeDeps: {
    exclude: ["@wlt/shared"],
  },
  server: {
    host: true, // 监听 0.0.0.0，内网其他设备可访问（访问者需信任自签名证书）
    port: 5174, // 电脑端
    ...(hasCerts
      ? {
          https: {
            key: fs.readFileSync(`${CERT_DIR}/key.pem`),
            cert: fs.readFileSync(`${CERT_DIR}/cert.pem`),
          },
        }
      : {}),
    proxy: {
      "/api": {
        target: "https://127.0.0.1:8443",
        changeOrigin: true,
        secure: false, // 开发自签名证书
      },
    },
  },
  build: { outDir: "dist" },
});
