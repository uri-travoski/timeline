# ---- web build ----
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npx vite build

# ---- server deps ----
FROM node:24-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx@4

# ---- runtime ----
FROM node:24-alpine
# ffmpeg: thumbnails + HLS reels renditions. python3 + yt-dlp: "post from URL" (Instagram, YouTube...).
RUN apk add --no-cache ffmpeg python3 ca-certificates tini su-exec \
 && wget -qO /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
 && chmod 0775 /usr/local/bin/yt-dlp && chown node:node /usr/local/bin/yt-dlp
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/migrations ./migrations
COPY --from=web /web/dist /app/web/dist
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_DIR=/app/web/dist
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/index.ts"]
