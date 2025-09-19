# Lyra Discord Bot - TypeScript with Sapphire Framework

Lyra is a Discord bot built with TypeScript using the Sapphire framework. It features music playback, word triggers, and various utility commands with SQLite database storage.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Build
- **Enable Corepack first**: `corepack enable` (REQUIRED before any yarn commands)
- **Install dependencies**: `yarn install` -- takes 60 seconds, includes native module compilation. NEVER CANCEL. Set timeout to 120+ seconds.
- **Build the project**: `yarn build` -- takes 1 second using tsup
- **Format code**: `yarn format` -- takes 1 second using prettier

### Development and Testing
- **Development mode**: `yarn dev` -- builds with watch mode and auto-restarts. NEVER CANCEL for long-running development.
- **Production mode**: `yarn start` -- runs the built application from dist/
- **Generate components**: `yarn generate <component> <name>` -- uses Sapphire CLI to scaffold commands, listeners, etc.

### Environment Setup
- **Required environment variables** (create `.env` file):
  - `DISCORD_TOKEN=your_bot_token`
  - `OWNERS=["user_id1","user_id2"]` -- array of Discord user IDs with admin privileges
  - `SQLITE_PATH=./data/word_triggers.db` -- optional, defaults to this path
- **Database initialization**: SQLite database and tables are auto-created on first run
- **Data directory**: Create `./data/` directory for database files

### Validation
- Always run `yarn format` before committing -- no ESLint configured, only prettier
- Test that the application starts without errors (it will fail gracefully without valid Discord token)
- Build succeeds quickly (~1 second) and produces files in `dist/` directory
- NEVER CANCEL any yarn commands, especially `yarn install` which compiles native modules

## Project Structure

### Key Directories
```
src/
├── commands/           # Bot slash commands and message commands
│   ├── General/       # Utility commands (ping, eval, keyword management)
│   └── music/         # Music playback commands (play, queue, skip)
├── listeners/         # Event handlers
│   ├── commands/      # Command success/error handlers
│   ├── WordTriggers.ts # Word trigger response system
│   ├── ready.ts       # Bot startup handler
│   └── player*.ts     # Music player event handlers
├── lib/               # Shared utilities and database
│   ├── database.ts    # SQLite database operations
│   ├── setup.ts       # Environment and plugin configuration
│   └── utils.ts       # Helper functions
├── preconditions/     # Command access control
├── routes/            # HTTP API endpoints (Sapphire API plugin)
├── LyraClient.ts      # Main bot client class
└── index.ts           # Application entry point
```

### Built Output
- **Distribution**: `dist/` -- compiled JavaScript files with source maps
- **Database**: `./data/word_triggers.db` -- SQLite database for word triggers and player state

## Common Commands and Their Purpose

### Music Commands (`src/commands/music/`)
- `play.ts` -- Play music from various sources (YouTube, SoundCloud, etc.)
- `queue.ts` -- Display current music queue
- `skip.ts` -- Skip current track
- `skipto.ts` -- Skip to specific track in queue

### General Commands (`src/commands/General/`)
- `ping.ts` -- Bot latency check
- `keyword.ts` -- Manage word trigger responses stored in database
- `eval.ts` -- Code evaluation (owner-only)
- `chaos.ts` -- Enable/disable chaos mode
- `record.ts` -- Voice recording functionality

### Database Schema
- `word_triggers` table -- stores keyword-response pairs
- `player_messages` table -- tracks music player UI messages for cleanup

## Deployment and Docker

### Docker Build
- **Base image**: `node:22-alpine`
- **Multi-stage build**: Separate builder and runtime stages
- **Build context**: Includes `packages/` directory for local node-crc module
- **Production command**: `yarn run start`
- **Network restrictions**: Docker build may fail in restricted environments due to Corepack download requirements

### GitHub Actions
- **Deployment trigger**: Push to main branch (unless commit contains `[skip deploy]`)
- **Build process**: Node.js 22, Docker build and push to GHCR
- **Registry**: `ghcr.io` with automatic container updates on server

## Troubleshooting

### Common Issues
- **"OWNERS must be an array"**: Set `OWNERS` environment variable as JSON array
- **Database path errors**: Create `data/` directory or set valid `SQLITE_PATH`
- **Network errors during install**: Normal for packages requiring external downloads (YouTube extractor)
- **Native module compilation**: `@discordjs/opus` and `better-sqlite3` require build tools

### Build Dependencies
- **Python 3**: Required for native module compilation
- **Build tools**: node-gyp, make, g++ (automatically available in most environments)
- **FFmpeg**: Installed via `@ffmpeg-installer/ffmpeg` package

## Framework-Specific Notes

### Sapphire Framework
- **Client class**: `LyraClient.ts` extends `SapphireClient`
- **Auto-loading**: Commands, listeners, and preconditions auto-discovered in configured directories
- **Plugin system**: Uses `@sapphire/plugin-api`, `@sapphire/plugin-logger`, etc.
- **Decorators**: Available via `@sapphire/decorators` for enhanced TypeScript features

### Discord Player Integration
- **Music library**: `discord-player` v7 with YouTube extractor
- **Audio processing**: `@discordjs/voice` and `@discordjs/opus` for voice connections
- **Extractors**: YouTube, SoundCloud, Vimeo, Spotify (metadata only)
- **Buffer timeout**: Set to 0 for seamless song transitions

Always validate your changes by building and testing the application startup. The bot will fail gracefully with clear error messages if environment setup is incomplete.