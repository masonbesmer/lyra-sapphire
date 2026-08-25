FROM node:24-slim AS builder

WORKDIR /app

# Build tooling for the native modules: better-sqlite3, @discordjs/opus, @sapphire/type.
# Debian rather than Alpine because ONNX Runtime ships glibc prebuilds — on musl they
# loaded and then aborted the process with Ort::Exception, killing the bot. The wake-word
# work in Task 7 needs that runtime, and @ffmpeg-installer/ffmpeg ships a glibc binary too.
RUN apt-get update && apt-get install -y --no-install-recommends \
	build-essential \
	python3 \
	pkg-config \
	&& rm -rf /var/lib/apt/lists/*

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
FROM node:24-slim

WORKDIR /app

# No build toolchain here. Both stages share this base, so the native modules the builder
# compiled are ABI-compatible and can simply be copied. The Alpine version had to reinstall
# and rebuild at this stage, which is what made the runtime image carry a full compiler.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# Create data directory for SQLite database
RUN mkdir -p /app/data

# `yarn start` is `node dist/index.js`; calling node directly means no yarn or corepack
# in the runtime image.
CMD ["node", "dist/index.js"]
