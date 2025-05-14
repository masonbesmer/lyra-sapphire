FROM node:22-alpine AS builder
WORKDIR /app

# Enable Corepack and activate Yarn 4.9.1
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

# Copy project files (NO .yarn/releases needed anymore)
COPY package.json yarn.lock .yarnrc.yml tsup.config.ts tsconfig.json ./

# Install all deps
RUN yarn workspaces focus --production

# build and copy source code
COPY . .
RUN yarn run build



# --- Runtime image ---
FROM node:22-alpine
WORKDIR /app

# Enable Corepack again
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

COPY package.json yarn.lock .yarnrc.yml tsup.config.ts tsconfig.json ../
RUN yarn workspaces focus --production

COPY --from=builder /app/dist ./dist

CMD ["yarn", "run", "start"]