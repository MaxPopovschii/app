FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY api/package.json ./api/package.json
COPY worker/package.json ./worker/package.json
COPY web/package.json ./web/package.json
RUN npm ci --ignore-scripts
COPY shared ./shared
COPY api ./api
COPY worker ./worker
COPY web ./web
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS api
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/artifacts && chown -R node:node /data
USER node
ENV ARTIFACT_DIR=/data/artifacts PORT=8080
EXPOSE 8080
CMD ["node", "api/dist/index.js"]

FROM mcr.microsoft.com/playwright:v1.57.0-noble AS worker
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app /app
RUN mkdir -p /data/artifacts && chown -R pwuser:pwuser /data
USER pwuser
ENV ARTIFACT_DIR=/data/artifacts
CMD ["node", "worker/dist/index.js"]
