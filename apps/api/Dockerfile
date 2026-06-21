FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# Build stage
FROM base AS builder
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

# Production stage
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER nodejs
EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/index.js"]
