# Build the PWA
FROM node:24-alpine AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

# Runtime: static files + WebSocket relay
FROM node:24-alpine
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/srv/dist
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/index.ts ./
COPY src/net/protocol.ts /srv/src/net/protocol.ts
COPY --from=app /app/dist /srv/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "index.ts"]
