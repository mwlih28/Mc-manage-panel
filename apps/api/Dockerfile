FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN ./node_modules/.bin/prisma generate
RUN npm run build

EXPOSE 3001
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --accept-data-loss && node dist/index.js"]
