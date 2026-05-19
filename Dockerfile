# Stage 1: Build
FROM mcr.microsoft.com/playwright:v1.60.0-noble AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc --noEmit && npx tsc

# Stage 2: Production
FROM mcr.microsoft.com/playwright:v1.60.0-noble AS runner

WORKDIR /app

# Copy built output and production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install chromium

COPY --from=builder /app/dist ./dist

# Production env
ENV NODE_ENV=production
ENV AUTOPILOT_KEEP_ALIVE=true
ENV HEADLESS=true

# Health check
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', r => process.exit(r.statusCode !== 200 ? 1 : 0)).on('error', () => process.exit(1))"

# Expose simple health endpoint port
EXPOSE 8080

# Start both scheduler and Telegram bot listener
CMD ["node", "dist/cron/index.js", "production"]
