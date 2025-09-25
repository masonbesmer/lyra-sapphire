FROM node:22-alpine AS builder

WORKDIR /app


# Install dependencies using Yarn
COPY package.json yarn.lock ./
RUN corepack enable && yarn workspaces focus --production


# Copy source files
COPY . .
RUN yarn build

# --- Runtime image ---
FROM node:22-alpine

WORKDIR /app


# Copy built application and necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/.yarnrc.yml ./.yarnrc.yml

# Install production dependencies in runtime image
RUN corepack enable && yarn workspaces focus --production

# Create data directory for SQLite database
RUN mkdir -p /app/data

CMD ["yarn", "start"]