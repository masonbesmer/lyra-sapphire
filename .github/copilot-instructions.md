# Lyra Discord Bot - AI Development Guide

## Architecture Overview

Lyra is a Discord bot built on **Sapphire Framework** with TypeScript. Core components:

- **`LyraClient`**: Extended SapphireClient with Discord Player integration and utils
- **Database**: SQLite with better-sqlite3 for persistence (word triggers, starboard, player messages)
- **Music System**: Discord Player v7 with YouTube and SoundCloud extractors
- **Starboard**: Reaction-based message highlighting with unique alphanumeric indices

## Development Patterns

### Command Structure

- Use `@ApplyOptions` decorator for command metadata
- Dual support: slash commands (`chatInputRun`) + text commands (`messageRun`)
- Subcommands via `@sapphire/plugin-subcommands` (see `src/commands/General/keyword.ts`)
- Preconditions for validation (e.g., `InVoiceWithBot` for music commands)

### Database Operations

- Direct SQL with prepared statements: `db.prepare('SELECT ...').run/get/all()`
- Schema auto-created in `src/lib/database.ts`
- Tables: `word_triggers`, `player_messages`, `starboard_config`, `starboard_messages`

### Music Integration

- Access via `useMainPlayer()` from discord-player
- Voice channel validation through `InVoiceWithBot` precondition
- Player cleanup on restart via `player_messages` table

### Starboard System

- Unique 5-char alphanumeric indices (`ABC12`) for message management
- SQLite conflict resolution with `ON CONFLICT(guild_id) DO UPDATE SET`
- Embed building with attachment detection in `src/lib/starboard.ts`

## Key Workflows

### Development

```bash
yarn dev          # Hot reload with tsup watch
yarn build        # Production build
yarn format       # Prettier formatting
```

### Environment Setup

- `.env` in `src/` directory (not root)
- Required: `DISCORD_TOKEN`, `OWNERS` (comma-separated user IDs)
- Optional: `SQLITE_PATH` (defaults to `./data/word_triggers.db`)

### Testing Features

- Set `chaosEnabled` flag to allow bot responses to bot messages
- Development guild ID in `src/lib/setup.ts` for command registration
- Use `yarn dev` for immediate code changes without rebuild

## Critical Implementation Details

### Dual Command Support

Always implement both slash and message variants:

```typescript
// Slash command
public async chatInputAdd(interaction: Command.ChatInputCommandInteraction) { ... }
// Text command
public async messageAdd(message: Message, args: Args) { ... }
```

### Database Schema

Tables are auto-created but follow exact naming/structure in `src/lib/database.ts`. Use prepared statements for all queries.

### Music System Integration

- Player instance attached to client: `this.container.client.player`
- Voice precondition required: `preconditions: ['InVoiceWithBot']`
- Defer interactions for audio processing: `await interaction.deferReply()`

### Listener Patterns

- Inherit from `Listener` with `@ApplyOptions({ event: 'eventName' })`
- Access client state via `this.container.client`
- Word triggers check message content with SQL LIKE patterns

### Error Handling

- Use ephemeral replies for command errors: `{ ephemeral: true }`
- Catch database errors and log via `this.container.logger.error()`
- Return user-friendly error messages, log technical details

### Pagination

Use `@sapphire/discord.js-utilities` PaginatedMessage for long lists (see keyword list command).

## File Organization

- Commands in `src/commands/[Category]/[command].ts`
- Listeners in `src/listeners/[event].ts`
- Shared logic in `src/lib/[module].ts`
- Preconditions in `src/preconditions/[Name].ts`

Keep business logic in `src/lib/` modules, use commands/listeners as thin interfaces.
