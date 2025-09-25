FROM node:22-alpine AS builder

WORKDIR /app

# Copy manifest and lockfile first
COPY package.json yarn.lock ./
# Copy all source files
COPY . .
# Install all dependencies (including devDependencies) using Yarn
RUN corepack enable && yarn install
# Build the project
RUN yarn build

# --- Runtime image ---
FROM node:22-alpine

WORKDIR /app


# Copy built application and necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/.yarnrc.yml ./.yarnrc.yml

# Install only production dependencies in runtime image
RUN corepack enable && yarn workspaces focus --production

# Create data directory for SQLite database
RUN mkdir -p /app/data

CMD ["yarn", "start"]