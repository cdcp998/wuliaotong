/// <reference types="vite/client" />

// vite 对 .wasm?url 返回带 hash 的静态资源 URL（与 JS 同目录，路径自动加 base 前缀）
declare module "*.wasm?url" {
  const src: string;
  export default src;
}
