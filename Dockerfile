FROM node:22-alpine AS builder
WORKDIR /app

# Enable Corepack and activate Yarn 4.9.1
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

# Copy project files (NO .yarn/releases needed anymore)
COPY package.json yarn.lock .yarnrc.yml .yarn/ ./

# Install all deps
RUN yarn install

# Copy source code and build
COPY . .
RUN yarn tsup src/index.ts --out-dir dist --format esm

# --- Runtime image ---
FROM node:22-alpine
WORKDIR /app

# Enable Corepack again
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

COPY package.json yarn.lock .yarnrc.yml .yarn/ ./
RUN yarn workspaces focus --all --production

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
