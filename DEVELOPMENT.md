# Lyra Bot Development Guide

This guide provides detailed information for developers who want to contribute to or modify the Lyra Discord bot.

## Architecture Overview

### Project Structure

```
lyra-sapphire/
├── src/                          # Source code
│   ├── LyraClient.ts            # Main bot client with music player
│   ├── index.ts                 # Entry point and startup logic
│   ├── .env                     # Environment configuration
│   ├── commands/                # Command implementations
│   │   ├── General/             # General purpose commands
│   │   │   ├── chaos.ts         # Chaos mode toggle
│   │   │   ├── eval.ts          # Code execution (owner only)
│   │   │   ├── keyword.ts       # Word trigger management
│   │   │   ├── ping.ts          # Latency testing
│   │   │   ├── record.ts        # Voice recording
│   │   │   ├── restart.ts       # Bot restart
│   │   │   └── starboard.ts     # Starboard management
│   │   └── music/               # Music-related commands
│   │       ├── play.ts          # Music playback
│   │       ├── queue.ts         # Queue display
│   │       ├── skip.ts          # Skip current song
│   │       └── skipto.ts        # Skip to position
│   ├── listeners/               # Event handlers
│   │   ├── ready.ts             # Bot startup handler
│   │   ├── WordTriggers.ts      # Keyword response handler
│   │   ├── starboardReactions.ts # Starboard reaction handler
│   │   ├── playerControls.ts    # Music button interactions
│   │   └── commands/            # Command event handlers
│   ├── lib/                     # Core libraries
│   │   ├── constants.ts         # Application constants
│   │   ├── database.ts          # SQLite setup and schema
│   │   ├── playerButtons.ts     # Music control buttons
│   │   ├── playerMessages.ts    # Player message cleanup
│   │   ├── setup.ts             # Framework configuration
│   │   ├── starboard.ts         # Starboard utilities
│   │   └── utils.ts             # Utility functions
│   ├── preconditions/           # Command preconditions
│   │   ├── InVoiceWithBot.ts    # Voice channel validation
│   │   └── OwnerOnly.ts         # Owner permission check
│   └── routes/                  # API routes (optional)
├── packages/                    # Local packages
│   └── node-crc/               # CRC calculation utilities
├── .vscode/                     # VS Code configuration
├── .github/workflows/           # CI/CD pipeline
├── data/                        # Database storage (created at runtime)
├── dist/                        # Compiled JavaScript (generated)
├── Dockerfile                   # Container configuration
├── docker-compose.example.yml   # Docker Compose template
├── package.json                 # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── tsup.config.ts              # Build configuration
└── .sapphirerc.yml             # Sapphire framework config
```

## Core Technologies

### Framework Stack

- **Sapphire Framework**: Discord.js-based bot framework with decorators and advanced features
- **discord-player**: Music playback system with multi-source support
- **TypeScript**: Type-safe JavaScript with modern language features
- **better-sqlite3**: High-performance SQLite database driver

### Build Tools

- **tsup**: Fast TypeScript bundler with watch mode
- **Yarn 4**: Package manager with workspace support
- **Corepack**: Node.js package manager version management

### Audio Processing

- **@discordjs/voice**: Discord voice connection handling
- **@discordjs/opus**: Audio encoding for voice
- **FFmpeg**: Audio processing and conversion
- **prism-media**: Media processing utilities

## Development Workflow

### Setting Up the Environment

1. **Clone and Install**:

    ```bash
    git clone https://github.com/masonbesmer/lyra-sapphire.git
    cd lyra-sapphire
    corepack enable
    yarn install
    ```

2. **Configure Environment**:

    ```bash
    cp src/.env.example src/.env
    # Edit src/.env with your bot token and owner IDs
    ```

3. **Development Server**:
    ```bash
    yarn dev  # Starts with hot reload
    ```

### Code Organization

#### Commands

Commands are organized using the Sapphire command structure:

```typescript
import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
	name: 'example',
	description: 'Example command',
	preconditions: ['InVoiceWithBot'] // Optional
})
export class ExampleCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) => option.setName('input').setDescription('Example input').setRequired(true))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		// Slash command logic
	}

	public override async messageRun(message: Message, args: Args) {
		// Text command logic (optional)
	}
}
```

#### Listeners

Event listeners handle Discord events and bot interactions:

```typescript
import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';

@ApplyOptions<Listener.Options>({
	event: 'messageCreate',
	once: false
})
export class ExampleListener extends Listener {
	public override run(message: Message) {
		// Event handling logic
	}
}
```

#### Database Operations

Database operations use prepared statements for security:

```typescript
import { db } from '../lib/database';

// Insert
const insertStmt = db.prepare('INSERT INTO table_name (column) VALUES (?)');
insertStmt.run(value);

// Select
const selectStmt = db.prepare('SELECT * FROM table_name WHERE column = ?');
const result = selectStmt.get(value);

// Update
const updateStmt = db.prepare('UPDATE table_name SET column = ? WHERE id = ?');
updateStmt.run(newValue, id);
```

## Key Components Deep Dive

### Music System

The music system is built on discord-player with the following flow:

1. **Command Processing** (`src/commands/music/play.ts`):
    - Validates user is in voice channel
    - Processes search query or URL
    - Initiates playback through discord-player

2. **Player Events** (`src/listeners/playerStart.ts`):
    - Handles track start events
    - Creates interactive control message
    - Stores message ID for cleanup

3. **Interactive Controls** (`src/lib/playerButtons.ts`):
    - Defines button components (play/pause, skip, etc.)
    - Handles button interactions
    - Updates player state

4. **Cleanup System** (`src/lib/playerMessages.ts`):
    - Tracks active player messages
    - Removes stale messages on bot restart
    - Prevents message accumulation

### Starboard System

The starboard tracks starred messages with a multi-step process:

1. **Reaction Detection** (`src/listeners/starboardReactions.ts`):
    - Listens for star emoji reactions
    - Validates message eligibility
    - Counts current stars

2. **Database Management** (`src/lib/starboard.ts`):
    - Manages starboard configuration per guild
    - Tracks starboard entries with unique indices
    - Handles star count updates

3. **Message Processing**:
    - Creates rich embeds for starboard posts
    - Handles image attachments
    - Updates existing starboard messages

### Word Trigger System

Simple keyword-response system:

1. **Trigger Detection** (`src/listeners/WordTriggers.ts`):
    - Scans all messages for registered keywords
    - Ignores bot messages
    - Supports case-insensitive matching

2. **Database Storage** (`src/lib/database.ts`):
    - Simple key-value storage in SQLite
    - Prepared statements for performance
    - Thread-safe operations

## Adding New Features

### Creating a New Command

1. **Create Command File**:

    ```bash
    # For general commands
    touch src/commands/General/mycommand.ts

    # For music commands
    touch src/commands/music/mycommand.ts
    ```

2. **Implement Command Structure**:

    ```typescript
    import { ApplyOptions } from '@sapphire/decorators';
    import { Command } from '@sapphire/framework';

    @ApplyOptions<Command.Options>({
    	name: 'mycommand',
    	description: 'My new command'
    })
    export class MyCommand extends Command {
    	public override registerApplicationCommands(registry: Command.Registry) {
    		registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
    	}

    	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    		return interaction.reply('Hello from my command!');
    	}
    }
    ```

3. **Test the Command**:
    ```bash
    yarn dev
    # Use /mycommand in Discord
    ```

### Adding a New Listener

1. **Create Listener File**:

    ```bash
    touch src/listeners/mylistener.ts
    ```

2. **Implement Event Handler**:

    ```typescript
    import { ApplyOptions } from '@sapphire/decorators';
    import { Listener } from '@sapphire/framework';
    import type { Message } from 'discord.js';

    @ApplyOptions<Listener.Options>({ event: 'messageUpdate' })
    export class MyListener extends Listener {
    	public override run(oldMessage: Message, newMessage: Message) {
    		// Handle message edit events
    	}
    }
    ```

### Database Schema Changes

1. **Update Schema** (`src/lib/database.ts`):

    ```typescript
    // Add new table creation
    db.exec(`
        CREATE TABLE IF NOT EXISTS my_new_table (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    ```

2. **Create Migration** (if needed):

    ```typescript
    // Check if column exists and add if missing
    const tableInfo = db.prepare('PRAGMA table_info(existing_table)').all();
    const hasNewColumn = tableInfo.some((col) => col.name === 'new_column');

    if (!hasNewColumn) {
    	db.exec('ALTER TABLE existing_table ADD COLUMN new_column TEXT');
    }
    ```

## Testing and Debugging

### Local Testing

1. **Development Mode**:

    ```bash
    yarn dev  # Hot reload enabled
    ```

2. **Debug Mode**:

    ```bash
    NODE_ENV=development yarn dev
    ```

3. **Database Inspection**:
    ```bash
    sqlite3 data/word_triggers.db
    .tables
    .schema table_name
    SELECT * FROM table_name;
    ```

### VS Code Debugging

1. **Set Breakpoints** in TypeScript files
2. **Run Debug Configuration**:
    - Press F5 or use "Debug Lyra Bot" configuration
    - Attach to running process with "Debug with Watch"

3. **Inspect Variables**:
    - Use VS Code's built-in debugger
    - Console.log statements for quick debugging

### Docker Testing

1. **Build and Test**:

    ```bash
    docker build -t lyra-test .
    docker run --rm -e DISCORD_TOKEN=test lyra-test
    ```

2. **Debug Container**:
    ```bash
    docker run -it --entrypoint /bin/sh lyra-test
    ```

## Performance Considerations

### Database Optimization

- **Use prepared statements** for repeated queries
- **Index frequently queried columns**:
    ```sql
    CREATE INDEX idx_guild_id ON starboard_config(guild_id);
    ```
- **Batch operations** when possible
- **Connection pooling** (single connection for SQLite)

### Memory Management

- **Clean up event listeners** when removing features
- **Dispose of voice connections** properly
- **Limit cache sizes** for large datasets
- **Use WeakMap** for temporary object associations

### Audio Performance

- **FFmpeg optimization** in Dockerfile
- **Opus encoding** for voice quality
- **Buffer management** for streaming
- **Connection reuse** for voice channels

## Deployment Considerations

### Environment Variables

| Variable        | Development               | Production                   | Purpose             |
| --------------- | ------------------------- | ---------------------------- | ------------------- |
| `NODE_ENV`      | `development`             | `production`                 | Runtime environment |
| `DISCORD_TOKEN` | Test bot token            | Production token             | Bot authentication  |
| `OWNERS`        | Your user ID              | Production owner IDs         | Admin access        |
| `SQLITE_PATH`   | `./data/word_triggers.db` | `/app/data/word_triggers.db` | Database location   |

### Production Checklist

- [ ] Environment variables configured
- [ ] Database permissions set correctly
- [ ] Audio dependencies installed (FFmpeg)
- [ ] Memory limits configured
- [ ] Backup strategy for database
- [ ] Monitoring and logging setup
- [ ] SSL certificates (if using API routes)

### CI/CD Pipeline

The GitHub Actions workflow:

1. **Triggers**: Push to main branch
2. **Build**: Creates Docker image with dependencies
3. **Test**: Builds successfully (no unit tests currently)
4. **Deploy**: Pushes to GitHub Container Registry
5. **Update**: SSH to production server and updates container

Required repository secrets:

- `GHCR_USERNAME`, `GHCR_TOKEN` - Container registry access
- `SSH_HOST`, `SSH_PORT`, `SSH_KEY`, `SSH_USERNAME` - Server access
- `SSH_COMMAND` - Container update command

## Contributing Guidelines

### Code Style

- **Use Prettier** for formatting (`yarn format`)
- **Follow TypeScript best practices**
- **Use Sapphire decorators** for configuration
- **Document public methods** with JSDoc
- **Use meaningful variable names**

### Git Workflow

1. **Create feature branch**: `git checkout -b feature/my-feature`
2. **Make changes** with descriptive commits
3. **Test thoroughly** in development
4. **Submit pull request** with detailed description
5. **Address review feedback**

### Pull Request Template

```markdown
## Description

Brief description of changes

## Changes Made

- [ ] Added new feature X
- [ ] Fixed bug Y
- [ ] Updated documentation

## Testing

- [ ] Tested locally
- [ ] Tested in Discord server
- [ ] No breaking changes

## Screenshots (if applicable)
```

### Common Pitfalls

1. **Not handling errors**: Always wrap async operations in try-catch
2. **Forgetting permissions**: Check both user and bot permissions
3. **Database race conditions**: Use transactions for related operations
4. **Memory leaks**: Properly dispose of event listeners and connections
5. **Rate limiting**: Respect Discord's API limits

## Advanced Topics

### Custom Preconditions

Create reusable permission checks:

```typescript
import { Precondition } from '@sapphire/framework';
import type { CommandInteraction, Message } from 'discord.js';

export class CustomPrecondition extends Precondition {
	public override messageRun(message: Message) {
		return this.checkPermission(message.author.id);
	}

	public override chatInputRun(interaction: CommandInteraction) {
		return this.checkPermission(interaction.user.id);
	}

	private checkPermission(userId: string) {
		// Custom logic here
		return this.ok();
	}
}
```

### Plugin Development

Extend functionality with Sapphire plugins:

```typescript
import { Plugin, SapphireClient } from '@sapphire/framework';

export class MyPlugin extends Plugin {
	public static [Symbol.for('nodejs.util.inspect.custom')](): string {
		return 'MyPlugin';
	}

	public override onLoad() {
		// Plugin initialization
	}

	public override onUnload() {
		// Plugin cleanup
	}
}

SapphireClient.plugins.registerPostInitializationHook(MyPlugin);
```

### Advanced Database Patterns

```typescript
// Transaction example
const transaction = db.transaction((items) => {
	const insert = db.prepare('INSERT INTO table (data) VALUES (?)');
	for (const item of items) {
		insert.run(item);
	}
});

transaction(dataArray);

// Migration system
class DatabaseMigrator {
	private static migrations = [
		{
			version: 1,
			up: () => db.exec('CREATE TABLE IF NOT EXISTS new_table (...)')
		}
	];

	public static migrate() {
		const currentVersion = this.getCurrentVersion();
		const targetVersion = this.migrations.length;

		for (let i = currentVersion; i < targetVersion; i++) {
			this.migrations[i].up();
			this.setVersion(i + 1);
		}
	}
}
```

This development guide should provide a solid foundation for understanding and extending the Lyra bot codebase.
