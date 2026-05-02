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

# Runtime dependencies: shared libraries for sharp/libvips AND build tools for native modules
RUN apk add --no-cache \
	vips \
	libc6-compat \
	build-base \
	python3 \
	pkgconfig && \
	corepack enable

# Copy built application and package files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/.yarnrc.yml ./.yarnrc.yml

# Install production dependencies (rebuilds native modules for this image)
RUN yarn install --production

# Create data directory for SQLite database
RUN mkdir -p /app/data

CMD ["yarn", "start"]