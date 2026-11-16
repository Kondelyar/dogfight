# syntax=docker/dockerfile:1

# ---------- Етап 1: збірка клієнта (потрібні dev-залежності: vite, typescript) ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci
COPY tsconfig.base.json ./
COPY client client
COPY shared shared
RUN npm run build -w client

# ---------- Етап 2: лише production-залежності сервера ----------
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --omit=dev --workspace=server --workspace=shared && npm cache clean --force

# ---------- Фінальний образ: без dev-залежностей, не від root ----------
FROM node:24-alpine
ARG GIT_SHA=dev
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    GIT_SHA=$GIT_SHA \
    APP_VERSION=$APP_VERSION
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared/package.json shared/package.json
COPY shared/src shared/src
COPY server/package.json server/package.json
COPY server/src server/src
COPY --from=build /app/client/dist client/dist

# npm, yarn, corepack і заголовки Node у фінальному образі не потрібні: запускаємо лише node
# (мінус ~30 МБ). журнали матчів пишуться на диск: каталог належить користувачу node
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
           /opt/yarn-v* /usr/local/include \
 && mkdir -p server/logs \
 && chown -R node:node server/logs
USER node

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# node напряму, а не npm start: інакше SIGTERM дістанеться npm, а не процесу гри
CMD ["node", "server/src/index.ts"]
