[![Deployment Status](https://github.com/masonbesmer/lyra-sapphire/actions/workflows/deployment.yml/badge.svg?branch=main)](https://github.com/masonbesmer/lyra-sapphire/actions/workflows/deployment.yml)

# Lyra - Advanced Discord Bot

Lyra is a feature-rich Discord bot built with the [Sapphire Framework][sapphire] and TypeScript. It provides music playback, starboard functionality, word triggers, voice recording, and administrative tools.

## 🚀 Features

### 🎵 Music System
- **Play music** from various sources (YouTube, SoundCloud, etc.)
- **Queue management** with skip, skip-to, and display commands
- **Voice channel integration** with seamless audio transitions
- **Player controls** with interactive buttons
- **Auto-cleanup** of stale player messages on restart

### ⭐ Starboard System
- **Automatic starboard posting** when messages reach star threshold
- **Configurable star requirements** (1-50 stars)
- **Unique alphanumeric indices** for easy message management
- **Real-time star count updates** as reactions change
- **Image support** in starboard embeds
- **Management commands** for viewing and deleting entries

See [STARBOARD.md](./STARBOARD.md) for detailed starboard documentation.

### 🔧 Word Triggers
- **Custom keyword responses** stored in SQLite database
- **Add, edit, delete, and list** keyword triggers
- **Automatic message responses** when keywords are detected
- **Persistent storage** with automatic database creation

### 🎙️ Voice Recording
- **Record audio** from voice channels (1-120 seconds)
- **Automatic conversion** to common audio formats
- **File upload** of recordings to Discord

### 🛠️ Administrative Tools
- **Eval command** for bot owners (code execution)
- **Restart command** for bot maintenance
- **Chaos mode** toggle for testing/fun
- **Owner-only preconditions** for sensitive commands

### 🗄️ Database Integration
- **SQLite database** for persistent data storage
- **Multiple tables** for different features:
  - `word_triggers` - Keyword responses
  - `player_messages` - Music player message cleanup
  - `starboard_config` - Per-guild starboard settings
  - `starboard_messages` - Starboard entry tracking

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Development Environment Setup](#development-environment-setup)
  - [Local Development](#local-development)
  - [Docker Development](#docker-development)
  - [VS Code Setup](#vs-code-setup)
- [Configuration](#configuration)
- [Commands Reference](#commands-reference)
- [Architecture Overview](#architecture-overview)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- **Node.js** 22.x or higher
- **Yarn** 4.9.4 (managed via Corepack)
- **FFmpeg** (for audio processing)
- **Docker** (optional, for containerized deployment)
- **Discord Bot Token** and **Application ID**

## Development Environment Setup

### Local Development

#### 1. Clone and Install Dependencies

```bash
git clone https://github.com/masonbesmer/lyra-sapphire.git
cd lyra-sapphire

# Enable Corepack for Yarn 4 support
corepack enable

# Install dependencies
yarn install
```

#### 2. Configure Environment Variables

Create a `.env` file in the `src/` directory:

```bash
cp src/.env.example src/.env
```

Edit `src/.env` with your bot configuration:

```env
# Required: Your Discord bot token
DISCORD_TOKEN=your_bot_token_here

# Required: Bot owner user IDs (comma-separated)
OWNERS=123456789012345678,987654321098765432

# Optional: Custom SQLite database path
SQLITE_PATH=./data/word_triggers.db
```

#### 3. Development Commands

```bash
# Start development server with hot reload
yarn dev

# Build the project
yarn build

# Start production build
yarn start

# Format code
yarn format
```

### Docker Development

#### 1. Create docker-compose.yml

Create a `docker-compose.yml` file in the project root:

```yaml
version: '3.8'

services:
  lyra-bot:
    build: .
    container_name: lyra-discord-bot
    restart: unless-stopped
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - OWNERS=${OWNERS}
      - SQLITE_PATH=/app/data/word_triggers.db
      - NODE_ENV=production
    volumes:
      - ./data:/app/data
    networks:
      - lyra-network

networks:
  lyra-network:
    driver: bridge

volumes:
  lyra-data:
```

#### 2. Environment Setup

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_bot_token_here
OWNERS=your_user_id_here
```

#### 3. Docker Commands

```bash
# Build and start the bot
docker-compose up --build -d

# View logs
docker-compose logs -f lyra-bot

# Stop the bot
docker-compose down

# Rebuild and restart
docker-compose up --build -d
```

### VS Code Setup

#### 1. Recommended Extensions

Install these VS Code extensions for the best development experience:

```json
{
  "recommendations": [
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-json",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense",
    "ms-vscode.vscode-eslint",
    "aaron-bond.better-comments",
    "oderwat.indent-rainbow"
  ]
}
```

#### 2. VS Code Workspace Configuration

The repository includes a `lyra-sapphire.code-workspace` file. Open it for the optimal development experience:

```bash
code lyra-sapphire.code-workspace
```

#### 3. Debug Configuration

Create `.vscode/launch.json` for debugging:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Lyra Bot",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/dist/index.js",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "yarn: build",
      "env": {
        "NODE_ENV": "development"
      },
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "name": "Debug with Watch",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/tsup",
      "args": ["--watch", "--onSuccess", "node ./dist/index.js"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

#### 4. Tasks Configuration

Create `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "yarn",
      "task": "build",
      "group": "build",
      "presentation": {
        "reveal": "silent"
      },
      "problemMatcher": "$tsc"
    },
    {
      "type": "yarn", 
      "task": "dev",
      "group": "test",
      "presentation": {
        "reveal": "always",
        "panel": "new"
      }
    }
  ]
}
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DISCORD_TOKEN` | Your Discord bot token | ✅ | - |
| `OWNERS` | Comma-separated list of owner user IDs | ✅ | - |
| `SQLITE_PATH` | Path to SQLite database file | ❌ | `./data/word_triggers.db` |
| `NODE_ENV` | Environment mode | ❌ | `development` |

### Configuration Files

| File | Purpose |
|------|---------|
| `src/.env` | Environment variables |
| `package.json` | Project dependencies and scripts |
| `tsconfig.json` | TypeScript compiler configuration |
| `tsup.config.ts` | Build tool configuration |
| `.sapphirerc.yml` | Sapphire framework configuration |
| `Dockerfile` | Docker container configuration |
| `.dockerignore` | Docker build exclusions |
| `yarn.lock` | Dependency lock file |
| `.yarnrc.yml` | Yarn configuration |

## Commands Reference

### Music Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/play` | Play music from various sources | `/play query:song name or URL` |
| `/skip` | Skip current song | `/skip` |
| `/skipto` | Skip to specific queue position | `/skipto position:3` |
| `/queue` | Display current music queue | `/queue` |

### Starboard Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/starboard config` | Show starboard configuration | `/starboard config` |
| `/starboard set-channel` | Set starboard channel | `/starboard set-channel channel:#starboard` |
| `/starboard set-threshold` | Set star threshold (1-50) | `/starboard set-threshold threshold:5` |
| `/starboard list` | List all starboard entries | `/starboard list` |
| `/starboard delete` | Delete starboard entry | `/starboard delete index:ABC12` |

### Word Trigger Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/keyword add` | Add new keyword trigger | `/keyword add keyword:hello response:Hello there!` |
| `/keyword edit` | Edit existing keyword | `/keyword edit keyword:hello response:Hey there!` |
| `/keyword delete` | Delete keyword trigger | `/keyword delete keyword:hello` |
| `/keyword list` | List all keyword triggers | `/keyword list` |

### Utility Commands

| Command | Description | Usage | Permissions |
|---------|-------------|-------|-------------|
| `/ping` | Check bot latency | `/ping` | Everyone |
| `/record` | Record voice channel audio | `/record seconds:30` | Everyone |
| `/chaos` | Toggle chaos mode | `/chaos enabled:true` | Owner only |
| `/eval` | Execute JavaScript code | `/eval code:console.log('test')` | Owner only |
| `/restart` | Restart the bot | `/restart` | Owner only |

### Text Commands

All slash commands also support text-based alternatives using the `%` prefix or mentioning the bot:

```
%ping
%play never gonna give you up
Hey Lyra, play some music
Lyra ping
```

## Architecture Overview

### Core Components

```
src/
├── LyraClient.ts          # Main bot client with music player
├── index.ts               # Entry point and startup logic
├── lib/                   # Core libraries and utilities
│   ├── setup.ts           # Environment and framework setup
│   ├── database.ts        # SQLite database configuration
│   ├── constants.ts       # Application constants
│   ├── utils.ts           # Utility functions
│   ├── starboard.ts       # Starboard system logic
│   ├── playerButtons.ts   # Music player button interactions
│   └── playerMessages.ts  # Player message cleanup
├── commands/              # Bot commands
│   ├── General/           # General purpose commands
│   └── music/             # Music-related commands
├── listeners/             # Event listeners
├── preconditions/         # Command preconditions
└── routes/                # API routes (if enabled)
```

### Key Dependencies

- **@sapphire/framework** - Discord bot framework
- **discord-player** - Music playback system
- **discord.js** - Discord API library
- **better-sqlite3** - SQLite database driver
- **tsup** - TypeScript build tool
- **@discordjs/voice** - Voice connection handling

### Database Schema

The bot uses SQLite with the following tables:

```sql
-- Word trigger responses
CREATE TABLE word_triggers (
    keyword TEXT PRIMARY KEY,
    response TEXT NOT NULL
);

-- Music player message cleanup
CREATE TABLE player_messages (
    channel_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL
);

-- Starboard configuration per guild
CREATE TABLE starboard_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT,
    threshold INTEGER DEFAULT 3
);

-- Starboard message tracking
CREATE TABLE starboard_messages (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    original_message_id TEXT NOT NULL,
    original_channel_id TEXT NOT NULL,
    starboard_message_id TEXT NOT NULL,
    star_count INTEGER NOT NULL,
    index_code TEXT NOT NULL UNIQUE
);
```

## Deployment

### Docker Deployment (Recommended)

The bot includes a multi-stage Dockerfile optimized for production:

```bash
# Build and deploy
docker build -t lyra-bot .
docker run -d \
  --name lyra-bot \
  --restart unless-stopped \
  -e DISCORD_TOKEN=your_token \
  -e OWNERS=your_user_id \
  -v $(pwd)/data:/app/data \
  lyra-bot
```

### GitHub Actions CI/CD

The repository includes automated deployment via GitHub Actions:

- **Trigger**: Push to `main` branch
- **Process**: Build Docker image → Push to GHCR → Deploy to server
- **Requirements**: Configure repository secrets for deployment

Required secrets:
- `GHCR_USERNAME` - GitHub Container Registry username
- `GHCR_TOKEN` - GitHub Container Registry token
- `SSH_HOST` - Deployment server hostname
- `SSH_PORT` - SSH port (usually 22)
- `SSH_KEY` - Private SSH key for server access
- `SSH_USERNAME` - SSH username
- `SSH_COMMAND` - Command to update container on server

### Manual Production Deployment

```bash
# Install dependencies
yarn install --production

# Build the project
yarn build

# Start with PM2 (recommended)
pm2 start ecosystem.config.js

# Or start directly
yarn start
```

## Troubleshooting

### Common Issues

#### "tsup: not found" Error
**Solution**: Ensure Corepack is enabled and dependencies are installed:
```bash
corepack enable
yarn install
```

#### Bot Not Responding to Commands
**Possible causes**:
- Missing `DISCORD_TOKEN` in environment variables
- Bot not invited to server with proper permissions
- Bot missing required intents

**Required bot permissions**:
- Send Messages
- Use Slash Commands
- Connect to Voice
- Speak in Voice
- Add Reactions
- Read Message History
- Embed Links
- Attach Files

#### Music Not Playing
**Possible causes**:
- FFmpeg not installed
- Bot not in voice channel
- Missing voice permissions
- Audio source unavailable

**Debug steps**:
```bash
# Check FFmpeg installation
ffmpeg -version

# Check bot logs for audio errors
docker-compose logs lyra-bot | grep -i audio
```

#### Database Errors
**Solution**: Ensure data directory exists and has write permissions:
```bash
mkdir -p data
chmod 755 data
```

#### Memory Issues in Docker
**Solution**: Increase Docker memory allocation or add memory limits:
```yaml
services:
  lyra-bot:
    # ... other config
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### Getting Help

1. **Check logs**: Use `yarn dev` or `docker-compose logs` to see detailed error messages
2. **Verify configuration**: Ensure all required environment variables are set
3. **Test permissions**: Verify the bot has necessary Discord permissions
4. **Update dependencies**: Run `yarn install` to ensure all packages are up to date

### Development Tips

- **Hot reload**: Use `yarn dev` for automatic restart on file changes
- **Debug mode**: Set `NODE_ENV=development` for verbose logging
- **Code formatting**: Run `yarn format` before committing changes
- **Database inspection**: Use SQLite browser tools to inspect `data/word_triggers.db`

## License

Dedicated to the public domain via the [Unlicense], courtesy of the Sapphire Community and its contributors.

[sapphire]: https://github.com/sapphiredev/framework
[unlicense]: https://github.com/sapphiredev/examples/blob/main/LICENSE.md
