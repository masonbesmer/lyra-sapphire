# Lyra Sapphire Discord Bot

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

Lyra is a TypeScript Discord bot built with the Sapphire framework that provides music playback, word triggers, starboard functionality, and various utility commands. The bot uses SQLite for data persistence and Discord Player for music functionality.

## Working Effectively

### Environment Setup and Installation
- **CRITICAL**: Enable Corepack first: `corepack enable && corepack prepare yarn@4.9.1 --activate`
- Install dependencies: `yarn install` -- takes ~1.5 minutes with native compilation. NEVER CANCEL. Set timeout to 180+ seconds.
  - This compiles native modules like @discordjs/opus, better-sqlite3, and others
  - Network access is required for downloading prebuilt binaries
  - Some binaries may fall back to source compilation which is normal and expected

### Building and Development
- Build the project: `yarn build` -- takes <1 second
- Watch mode for development: `yarn dev` -- automatically rebuilds and restarts on file changes
- Production start: `yarn start` -- runs the built application
- Format code: `yarn format` -- takes <1 second, uses Prettier

### Environment Configuration
The bot requires proper environment configuration in `src/.env`:
```bash
# Required for bot operation
DISCORD_TOKEN=your_discord_bot_token
OWNERS=["user_id_1", "user_id_2"]  # Array format required

# Optional database configuration
SQLITE_PATH=./data/word_triggers.db  # Defaults to this path if not specified
```

**CRITICAL ENVIRONMENT NOTES**:
- `OWNERS` must be a valid JSON array format: `["123456789", "987654321"]`
- Without `DISCORD_TOKEN`, the bot will fail with "TokenInvalid" error
- Without `OWNERS`, the bot will fail with "The key must be an array, but is empty or undefined"
- The bot creates the SQLite database automatically if it doesn't exist

## Validation and Testing

### Manual Validation Requirements
After making changes, ALWAYS perform these validation steps:

1. **Build Validation**: `yarn build` must complete successfully in <1 second
2. **Format Validation**: `yarn format` must complete without errors in <1 second
3. **Environment Validation**: With proper environment variables:
   - The bot should start and load all modules successfully
   - It should create/access the SQLite database without ENOENT errors
   - Network errors (ENOTFOUND discord.com/youtube.com) are expected in restricted environments

### Testing Environment Setup
For testing purposes, create a minimal environment:
```bash
# Create test environment
mkdir -p /tmp/bot-test
cat > /tmp/bot-test/.env << EOF
DISCORD_TOKEN=dummy-token-for-testing
OWNERS=["123456789"]
SQLITE_PATH=/tmp/bot-test/test.db
EOF

# Copy to src for testing
cp /tmp/bot-test/.env src/.env
yarn build && timeout 10 yarn start
```

Expected behavior: Bot loads all modules successfully, creates database, fails only on Discord connection (expected without real token).

### Key Validation Scenarios
1. **Database Operations**: The bot should create SQLite tables for `word_triggers` and `player_messages`
2. **Module Loading**: All commands, listeners, and preconditions should load without errors
3. **Music System**: Discord Player extractors should initialize (YouTube extractor may fail due to network restrictions)

## Repository Structure and Navigation

### Key Directories
- `src/commands/` - Discord commands organized by category
  - `General/` - Utility commands (ping, eval, keyword management, etc.)
  - `music/` - Music playback commands (play, skip, queue, etc.)
- `src/listeners/` - Event handlers for Discord events and command responses
- `src/lib/` - Core utilities and shared functionality
  - `database.ts` - SQLite database setup and schema
  - `setup.ts` - Bot configuration and environment loading
  - `playerMessages.ts`, `playerButtons.ts` - Music player UI components
- `src/preconditions/` - Permission and validation checks
- `src/routes/` - API endpoints (Sapphire API plugin)

### Important Files
- `src/.env` - Environment configuration (git-ignored, contains secrets)
- `src/LyraClient.ts` - Main bot client class with Discord Player integration
- `src/index.ts` - Application entry point
- `tsup.config.ts` - Build configuration for TypeScript compilation
- `Dockerfile` - Container configuration for deployment

### Common File Patterns
- Commands use `@ApplyOptions` decorators and extend Sapphire base classes
- Listeners handle Discord events and bot lifecycle events
- Database operations use prepared statements with better-sqlite3
- Music functionality requires voice channel permissions and bot presence

## Deployment and Production

### Docker Deployment
The project includes a production Dockerfile that:
1. Uses Node.js 22 Alpine base image
2. Enables Corepack for Yarn 4.9.1
3. Installs dependencies and builds the application
4. Creates a minimal runtime image

### GitHub Actions
- `.github/workflows/deployment.yml` handles automatic deployment to GitHub Container Registry
- Deployment triggers on pushes to main branch (unless commit contains `[skip deploy]`)
- Requires secrets: `GHCR_USERNAME`, `GHCR_TOKEN`, SSH connection details

## Troubleshooting Common Issues

### Build Issues
- **"@swc/core was not installed"**: This is a warning, not an error. The build uses TypeScript compiler instead.
- **Native module compilation failures**: Ensure build tools are available (`build-essential` on Linux)

### Runtime Issues
- **ENOENT database errors**: Check `SQLITE_PATH` environment variable and directory permissions
- **"OWNERS must be an array"**: Ensure `OWNERS` is valid JSON array format in .env
- **Module loading errors**: Ensure all dependencies are installed with `yarn install`

### Network Issues
- **YouTube extractor failures**: Expected in restricted network environments
- **Discord connection failures**: Expected without valid `DISCORD_TOKEN`

## Development Best Practices

### Code Style
- Always run `yarn format` before committing - the CI will fail if code is not properly formatted
- Use existing patterns for new commands and listeners
- Follow Sapphire framework conventions for decorators and class structure

### Database Changes
- Database schema is automatically created on startup
- Use prepared statements for all database operations
- Test database operations with valid `SQLITE_PATH` configuration

### Music Features
- Music commands require bot to be in voice channel with user
- Test music functionality requires Discord token and voice channel access
- YouTube functionality may be limited in restricted network environments

## Package Management
- Uses Yarn 4.9.1 with Corepack
- Includes custom package: `node-crc` in `packages/` directory
- Dependencies include Discord.js, Sapphire framework, Discord Player, and better-sqlite3

Remember: Network access to Discord and YouTube is required for full bot functionality, but the application should start and load all modules successfully even in restricted environments.