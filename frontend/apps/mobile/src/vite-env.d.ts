/// <reference types="vite/client" />

// vite 对 .wasm?url 返回带 hash 的静态资源 URL（与 JS 同目录，路径自动加 base 前缀）
declare module "*.wasm?url" {
  const src: string;
  export default src;
}

// 构建时注入的前端应用版本（vite.config.ts 读取本包 package.json.version，
// 与后端 backend/app/__init__.py 的 __version__ 保持一致，由 scripts/check_version.py 强制）
declare const __APP_VERSION__: string;
