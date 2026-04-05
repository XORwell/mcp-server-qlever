FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
# --ignore-scripts prevents malicious postinstall scripts during build
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
# Production dependencies only — excludes typescript, vitest, @types/node
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist/ dist/

ENV NODE_ENV=production

RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

ENTRYPOINT ["node", "dist/index.js"]
