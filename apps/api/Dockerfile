# node:20-slim, pinned by digest so a compromised/retagged upstream image
# can't silently change what CI builds and ships.
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN ./node_modules/.bin/prisma generate
RUN npm run build

EXPOSE 3001
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --accept-data-loss && node dist/index.js"]
