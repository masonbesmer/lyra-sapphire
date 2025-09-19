# Lyra Bot Commands Reference

This document provides a comprehensive overview of all available commands in the Lyra Discord bot.

## Command Interfaces

Lyra supports three different ways to invoke commands:

1. **Slash Commands**: `/command` (recommended)
2. **Prefix Commands**: `%command` 
3. **Mention Commands**: `@Lyra command` or `Hey Lyra, command`

## Music Commands

### `/play <query>` 
**Description**: Play music from various sources  
**Usage**: `/play query:never gonna give you up`  
**Text equivalent**: `%play never gonna give you up`  
**Preconditions**: Must be in the same voice channel as the bot  
**Sources supported**: YouTube, SoundCloud, Spotify playlists, direct URLs

### `/skip`
**Description**: Skip the currently playing song  
**Usage**: `/skip`  
**Text equivalent**: `%skip`  
**Preconditions**: Must be in the same voice channel as the bot

### `/skipto <position>`
**Description**: Skip to a specific position in the queue  
**Usage**: `/skipto position:3`  
**Text equivalent**: `%skipto 3`  
**Preconditions**: Must be in the same voice channel as the bot

### `/queue`
**Description**: Display the current music queue  
**Usage**: `/queue`  
**Text equivalent**: `%queue`  
**Features**: Shows current song, queue length, and next tracks

## Starboard Commands

### `/starboard config`
**Description**: Show current starboard configuration  
**Usage**: `/starboard config`  
**Text equivalent**: `%starboard` or `%starboard config`  
**Permissions**: Manage Server (for configuration changes)

### `/starboard set-channel <channel>`
**Description**: Set the channel where starred messages will be posted  
**Usage**: `/starboard set-channel channel:#starboard`  
**Text equivalent**: `%starboard set-channel #starboard`  
**Permissions**: Manage Server

### `/starboard set-threshold <number>`
**Description**: Set how many stars are required (1-50)  
**Usage**: `/starboard set-threshold threshold:5`  
**Text equivalent**: `%starboard set-threshold 5`  
**Default**: 3 stars  
**Permissions**: Manage Server

### `/starboard list`
**Description**: Show paginated list of all starboard entries  
**Usage**: `/starboard list`  
**Text equivalent**: `%starboard list`  
**Features**: Interactive pagination, shows indices and star counts

### `/starboard delete <index>`
**Description**: Delete a starboard entry by its unique index  
**Usage**: `/starboard delete index:ABC12`  
**Text equivalent**: `%starboard delete ABC12`  
**Permissions**: Manage Server

## Word Trigger Commands

### `/keyword add <keyword> <response>`
**Description**: Add a new keyword trigger  
**Usage**: `/keyword add keyword:hello response:Hello there!`  
**Text equivalent**: `%keyword add hello "Hello there!"`  
**Features**: Bot will respond with the specified message when the keyword is mentioned

### `/keyword edit <keyword> <response>`
**Description**: Edit an existing keyword trigger  
**Usage**: `/keyword edit keyword:hello response:Hey there!`  
**Text equivalent**: `%keyword edit hello "Hey there!"`

### `/keyword delete <keyword>`
**Description**: Delete a keyword trigger  
**Usage**: `/keyword delete keyword:hello`  
**Text equivalent**: `%keyword delete hello`

### `/keyword list`
**Description**: List all keyword triggers  
**Usage**: `/keyword list`  
**Text equivalent**: `%keyword list`  
**Features**: Paginated display of all keywords and their responses

## Utility Commands

### `/ping`
**Description**: Check bot latency and response time  
**Usage**: `/ping`  
**Text equivalent**: `%ping`  
**Returns**: WebSocket heartbeat and round-trip times

### `/record <seconds>`
**Description**: Record audio from your current voice channel  
**Usage**: `/record seconds:30`  
**Text equivalent**: `%record 30`  
**Limits**: 1-120 seconds  
**Preconditions**: Must be in a voice channel  
**Output**: Audio file uploaded to Discord

## Administrative Commands

> **Note**: These commands are restricted to bot owners only

### `/chaos <enabled>`
**Description**: Toggle chaos mode for testing  
**Usage**: `/chaos enabled:true`  
**Text equivalent**: `%chaos true`  
**Permissions**: Owner only  
**Purpose**: Development and testing feature

### `/eval <code>`
**Description**: Execute JavaScript code (DANGEROUS)  
**Usage**: `/eval code:console.log('Hello')`  
**Text equivalent**: `%eval console.log('Hello')`  
**Permissions**: Owner only  
**⚠️ **Warning**: This command can execute arbitrary code and should only be used by trusted developers

### `/restart`
**Description**: Restart the bot  
**Usage**: `/restart`  
**Text equivalent**: `%restart`  
**Permissions**: Owner only  
**Process**: Gracefully shuts down and exits (requires process manager to restart)

## Example Commands

### Sample Usage Patterns

```bash
# Music commands
/play query:lofi hip hop
%play https://youtube.com/watch?v=dQw4w9WgXcQ
Hey Lyra, play some relaxing music

# Starboard setup
/starboard set-channel channel:#highlights
/starboard set-threshold threshold:5
%starboard config

# Word triggers
/keyword add keyword:thanks response:You're welcome! 😊
%keyword add "good morning" "Good morning! Have a great day!"

# Utility
/ping
%record 60
```

## Interactive Features

### Music Player Controls
When music is playing, interactive buttons appear:
- ⏯️ **Play/Pause**: Toggle playback
- ⏭️ **Skip**: Skip current song  
- 🔀 **Shuffle**: Shuffle queue
- 🔁 **Loop**: Toggle loop mode
- ⏹️ **Stop**: Stop playback and clear queue

### Starboard Reactions
- React with ⭐ to any message to potentially add it to the starboard
- Star count updates in real-time
- Messages automatically removed if they fall below threshold

### Paginated Displays
Commands like `/starboard list` and `/keyword list` use interactive pagination:
- ◀️ **Previous Page**
- ▶️ **Next Page**
- Numbers show current page position

## Permissions Required

### Bot Permissions
The bot needs these Discord permissions to function properly:
- **Send Messages** - Basic command responses
- **Use Slash Commands** - Slash command functionality  
- **Connect** - Join voice channels
- **Speak** - Play audio in voice channels
- **Add Reactions** - Starboard functionality
- **Read Message History** - Access to message content
- **Embed Links** - Rich embed displays
- **Attach Files** - Audio recording uploads
- **Manage Messages** - Starboard message management

### User Permissions
- **Starboard management**: Requires "Manage Server" permission
- **Administrative commands**: Bot owner only (configured via OWNERS environment variable)
- **Music commands**: Must be in same voice channel as bot
- **General commands**: Available to all users

## Error Handling

### Common Error Messages

| Error | Cause | Solution |
|-------|--------|----------|
| "You must be in a voice channel" | User not in voice channel | Join a voice channel first |
| "I cannot join that voice channel" | Missing permissions | Check bot voice permissions |
| "Command failed" | Various issues | Check bot logs for details |
| "Not found" | Invalid keyword/starboard index | Verify the item exists |
| "Permission denied" | Insufficient permissions | Check user/bot permissions |

### Troubleshooting Tips

1. **Commands not working**: Verify bot has necessary permissions
2. **Music not playing**: Check voice permissions and FFmpeg installation
3. **Starboard not working**: Ensure starboard channel is set and bot can manage messages
4. **Database errors**: Check file permissions for SQLite database

## Rate Limits

Discord imposes rate limits on bot commands:
- **Slash commands**: Generally unlimited for most use cases
- **Message commands**: Subject to Discord's message rate limits
- **Music playback**: Limited by voice connection constraints

The bot includes built-in handling for these limits and will queue operations when necessary.