FROM oven/bun:1.3.11

WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN bun install --frozen-lockfile
COPY apps/worker/src ./apps/worker/src

WORKDIR /app/apps/worker

CMD ["bun", "src/index.js"]
