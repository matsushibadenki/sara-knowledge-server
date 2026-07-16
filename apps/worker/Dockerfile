FROM oven/bun:1.1.45

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY src ./src

CMD ["bun", "src/index.js"]
