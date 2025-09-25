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

# Copy built application and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create data directory for SQLite database
RUN mkdir -p /app/data

CMD ["yarn", "start"]