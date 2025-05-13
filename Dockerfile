# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx tsup src/index.ts --out-dir dist --format esm

# Runtime stage
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --omit=dev

CMD ["node", "dist/index.js"]