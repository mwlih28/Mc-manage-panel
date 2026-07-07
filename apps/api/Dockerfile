# node:20-slim, pinned by digest so a compromised/retagged upstream image
# can't silently change what CI builds and ships.
FROM node:26-slim@sha256:a1d9d671994fc2d26e297ac56b4b1522a8bc7fa71c43b14cd1b1fe6c5116f7dc
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json ./
RUN npm install --no-fund --no-audit

COPY . .
RUN ./node_modules/.bin/prisma generate
RUN npm run build

EXPOSE 3001
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --accept-data-loss && node dist/index.js"]
