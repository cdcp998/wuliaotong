/// <reference types="vite/client" />

// 构建时注入的前端应用版本（vite.config.ts 读取本包 package.json.version，
// 与后端 backend/app/__init__.py 的 __version__ 保持一致，由 scripts/check_version.py 强制）
declare const __APP_VERSION__: string;
