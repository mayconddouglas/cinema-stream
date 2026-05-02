FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY proxy/server.mjs ./proxy/server.mjs

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "proxy/server.mjs"]
