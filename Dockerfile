# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Enable corepack and install Yarn 4
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

COPY package*.json yarn.lock ./
RUN yarn install

COPY . .
RUN npx tsup src/index.ts --out-dir dist --format esm

# Runtime stage
FROM node:22-alpine
WORKDIR /app

# Enable Corepack in runtime too
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

COPY --from=builder /app/dist ./dist
COPY package*.json yarn.lock ./
RUN yarn install --production

CMD ["node", "dist/index.js"]
