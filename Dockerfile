# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — build: instala TODAS las deps (incl. dev) y compila TS → dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Copiamos solo manifiestos primero para aprovechar la cache de capas:
# si package*.json no cambia, Docker reusa la capa de npm ci.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime: imagen mínima, solo deps de producción + dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini: init liviano que reenvía señales (SIGTERM) correctamente al proceso Node,
# para que enableShutdownHooks() de Nest cierre limpio (pool de DB, etc).
RUN apk add --no-cache tini

# Solo dependencias de producción (typeorm viaja en dependencies → CLI disponible).
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Artefacto compilado y el entrypoint.
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./

# Usuario no-root (principio de menor privilegio).
RUN chmod +x docker-entrypoint.sh \
  && addgroup -S nodejs && adduser -S nestjs -G nodejs \
  && chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 3000

# tini como PID 1 → maneja señales; el entrypoint corre migraciones y luego CMD.
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
