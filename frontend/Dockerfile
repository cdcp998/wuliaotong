# 物料通前端镜像（多阶段：Node 构建 → Nginx 托管静态资源 + API 反代）
# 构建产物：apps/desktop/dist（电脑端 /）、apps/mobile/dist（手机端 /m/，vite base=/m/）

# ---- 构建阶段 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build

# ---- 运行阶段 ----
FROM nginx:1.27-alpine
COPY --from=build /app/apps/desktop/dist /usr/share/nginx/html/desktop
COPY --from=build /app/apps/mobile/dist /usr/share/nginx/html/mobile
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
