FROM node:24-alpine AS builder

WORKDIR /app

# Install build tooling needed for native dependencies like sharp/better-sqlite3
RUN apk add --no-cache \
	build-base \
	python3 \
	pkgconfig \
	vips-dev \
	libc6-compat

# Copy manifest and lockfile first
COPY package.json yarn.lock ./
# Copy all source files
COPY . .
# Install all dependencies (including devDependencies) using Yarn
RUN corepack enable && yarn install
# Build the project
RUN yarn build
# Prune to production dependencies (while build tools are available)
RUN yarn workspaces focus --production

# --- Runtime image ---
FROM node:24-alpine

WORKDIR /app

# Runtime shared libraries for sharp/libvips
RUN apk add --no-cache vips libc6-compat

# Copy built application and necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/.yarnrc.yml ./.yarnrc.yml
COPY --from=builder /app/node_modules ./node_modules

# Create data directory for SQLite database
RUN mkdir -p /app/data

CMD ["yarn", "start"]