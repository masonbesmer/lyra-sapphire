FROM node:22-alpine AS builder
WORKDIR /app

# Enable Corepack and activate Yarn 4.9.1
RUN corepack enable && corepack prepare yarn@4.9.1 --activate

# Copy project files (NO .yarn/releases needed anymore)
COPY package.json yarn.lock .yarnrc.yml ./

# Install all deps
RUN yarn workspaces focus --production

# build and copy source code
RUN yarn run build

#COPY . .

# --- Runtime image ---
FROM node:22-alpine
WORKDIR /app

# Enable Corepack again
# RUN corepack enable && corepack prepare yarn@4.9.1 --activate

# COPY package.json yarn.lock .yarnrc.yml ../
#RUN yarn workspaces focus --all --production

COPY --from=builder /app/dist ./dist

CMD ["yarn", "run", "start"]