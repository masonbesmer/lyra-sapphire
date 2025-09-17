FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies using npm (more reliable in Docker environments)
COPY package.json ./
# Convert yarn.lock to package-lock if needed, or just use npm
RUN npm install --production --no-audit --no-fund

# Copy source files
COPY . .
RUN npm run build

# --- Runtime image ---
FROM node:22-alpine

WORKDIR /app

# Copy built application and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create data directory for SQLite database
RUN mkdir -p /app/data

CMD ["npm", "run", "start"]