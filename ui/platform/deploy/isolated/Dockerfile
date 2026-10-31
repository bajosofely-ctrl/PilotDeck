ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
ARG SQLITE_BINARY_MIRROR
ENV NODE_ENV=production PLATFORM_HOST=127.0.0.1 PLATFORM_PORT=3100 PLATFORM_DATABASE=/data/platform.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm_config_better_sqlite3_binary_host_mirror="$SQLITE_BINARY_MIRROR" npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && node -e "const D=require('better-sqlite3');const db=new D(':memory:');db.close()"
COPY server ./server
COPY admin/dist ./admin/dist
COPY backup.mjs ./
RUN mkdir /data /backups && chown node:node /data /backups
USER node
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
