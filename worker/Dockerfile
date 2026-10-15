# The render worker, for any host that runs containers (Railway, Render,
# Fly, a VPS). Build from the repo's root:
#   docker build -f worker/Dockerfile -t hookline-worker .
#   docker run --env-file .env.worker hookline-worker
# It takes the same settings as the app.
FROM node:22-bookworm-slim

# what Chrome needs to run headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 \
    libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile
COPY . .
# Remotion's own headless Chrome, fetched once at build time
RUN node -e "require('@remotion/renderer').ensureBrowser()"

ENV NODE_ENV=production
CMD ["pnpm", "worker"]
