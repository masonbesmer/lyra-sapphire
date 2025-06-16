FROM node:22 AS builder

WORKDIR /app

# Enable Corepack and activate Yarn 4.9.1
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

# Copy project files (NO .yarn/releases needed anymore)
COPY package.json yarn.lock .yarnrc.yml tsup.config.ts tsconfig.json ./

# Install all deps
# Attempt install
RUN yarn workspaces focus --production

# build and copy source code
COPY . .
RUN yarn run build

# --- Runtime image ---
FROM node:22

WORKDIR /app

# Enable Corepack again
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

CMD ["yarn", "run", "start"]