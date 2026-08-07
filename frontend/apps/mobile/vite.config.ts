import fs from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// HTTPS 开发环境（本地 80 被业务占用；复用 backend/certs/dev 自签名证书）
// 路径基于本文件所在目录解析：apps/mobile → 项目根 → backend/certs/dev
const CERT_DIR = "../../../backend/certs/dev";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // 生产构建部署在 /m/ 前缀（Nginx 分发：/ → 电脑端，/m → 手机端）；开发端口直跑根路径
  base: command === "build" ? "/m/" : "/",
  server: {
    host: true, // 监听 0.0.0.0，内网其他设备可访问（访问者需信任自签名证书）
    port: 5175, // 手机端
    https: {
      key: fs.readFileSync(`${CERT_DIR}/key.pem`),
      cert: fs.readFileSync(`${CERT_DIR}/cert.pem`),
    },
    proxy: {
      "/api": {
        target: "https://127.0.0.1:8443",
        changeOrigin: true,
        secure: false, // 开发自签名证书
      },
    },
  },
  build: { outDir: "dist" },
}));
