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

### `/play-file <file>`

**Description**: Play an audio file you upload  
**Usage**: `/play-file file:[attach a file]`  
**Text equivalent**: attach the file to the message and send `%play-file`  
**Preconditions**: Must be in the same voice channel as the bot  
**Accepted formats**: `.mp3`, `.m4a`, `.m4b`, `.aac`, `.flac`, `.wav`, `.ogg`, `.oga`, `.opus`, `.webm`, `.mka`  
**Limits**: 100 MB per file; 3 uses per 10 seconds per user

### `/play-file-multi <file1> [file2 … file10]`

**Description**: Queue several uploaded audio files at once  
**Usage**: `/play-file-multi file1:[attach] file2:[attach] …`  
**Text equivalent**: attach up to 10 files to the message and send `%play-file-multi`  
**Preconditions**: Must be in the same voice channel as the bot  
**Limits**: 10 files per invocation; 2 uses per 30 seconds per user  
**Behaviour**: Files are validated one at a time — a rejected upload is reported and skipped
rather than failing the whole batch

**Upload validation** (both commands, in `src/lib/attachmentAudio.ts`):

- The URL must be `https` on `cdn.discordapp.com` / `media.discordapp.net`. Lavalink resolves
  whatever URL it is handed from inside the Docker network, so an unrestricted URL here would be
  an SSRF primitive.
- The extension must be on the audio allowlist. Playlist/manifest formats (`.m3u`, `.m3u8`,
  `.pls`, `.xspf`, `.asx`) are excluded on purpose: lavaplayer follows the URLs inside them, which
  is the same SSRF hole by another route.
- If Discord reports a content type it must be an audio MIME, so a video renamed to `.mp3` is
  turned away. `application/octet-stream` passes, because Discord reports it for anything the
  uploader's browser could not identify — those files still clear the extension check, and
  Lavalink probes the container before playing a byte.
- The first 64 bytes are read off the CDN and matched against known container signatures (ID3 /
  MPEG frame sync, `fLaC`, `OggS`, `RIFF….WAVE`, `ftyp`, EBML). This is the check that actually
  enforces "audio only": lavaplayer picks a container by probing content rather than by
  extension, so without it an M3U renamed `.mp3` would still be read as a playlist. It fails
  closed — unreadable bytes mean the file does not play.
- Filenames are stripped of Unicode control/format characters and markdown-escaped, and every
  reply is sent with `allowedMentions: { parse: [] }` — `@everyone.mp3` is a legal upload name.

Note that a Discord CDN link is signed and expires (roughly 24 hours), so a file left sitting deep
in the queue can stop resolving before it is reached.

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

### `/config music idle-timeout <seconds>`

**Description**: How long the music bot stays in voice after playback ends
**Usage**: `/config music idle-timeout seconds:300`
**Text equivalent**: `%config music idle-timeout 300`
**Default**: 300 seconds (5 minutes); `0` keeps it in voice until something disconnects it
**Permissions**: Manage Server
**Behaviour**: The timer starts when the queue runs dry (after autoplay has had its turn) and
is cancelled the moment a track starts.

## Voice Assistant Commands

### `/assistant follow on|off|status`

**Description**: Have Lyra join your voice channel when you join one
**Usage**: `/assistant follow on`
**Permissions**: None — it is a personal setting, per member and per server, like `/assistant optout`

**Behaviour**:

- When a member with follow on joins a voice channel, Lyra joins them after the guild's follow
  delay, and starts listening for the wake word.
- She only joins when she isn't already listening somewhere. Following never drags her out of a
  channel she is already in, so people already talking to her keep her.
- Leaving before the delay elapses cancels the join, so channel-hopping doesn't drag her around.
- A follower leaving does **not** end the session. Lyra leaves when the last person in her
  channel does, exactly as before.

### `/config voice follow-delay <seconds>`

**Description**: How long Lyra waits before following a member into voice
**Usage**: `/config voice follow-delay seconds:10`
**Text equivalent**: `%config voice follow-delay 10`
**Default**: 10 seconds; `0` joins as soon as they arrive
**Permissions**: Manage Server

### Wake word feedback

**Behaviour**:

- When the wake word fires, Lyra plays a short two-note chime in the voice channel, so you know
  she is listening before you say the command. Capture has already started by the time it plays,
  so the chime never eats the start of what you say.
- The chime is skipped when something else is already playing through her voice connection — a
  spoken acknowledgement is the stronger signal, and a late chime marks the wrong moment.
- When the wake word fires but the command isn't one she knows, she says so — `I don't know that
one`, with what she heard — rather than going quiet. Speech that never woke her is still
  ignored without a word.
- Both follow the guild's **Acknowledgements** setting: `text` posts in the text channel, `tts`
  speaks it, `none` stays silent. The chime itself has its own toggle (**Wake chime**) in the
  dashboard, shown in `/assistant status`.

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

Triggers are scoped to the server they were added in — a trigger only fires, and
is only listed, in its own guild. Every subcommand requires **Manage Server**.

### `/keyword add <keyword> <response>`

**Description**: Add a new keyword trigger  
**Usage**: `/keyword add keyword:hello response:Hello there!`  
**Text equivalent**: `%keyword add hello "Hello there!"`  
**Permissions**: Manage Server  
**Features**: Bot will respond with the specified message when the keyword is mentioned

### `/keyword edit <keyword> <response>`

**Description**: Edit an existing keyword trigger  
**Usage**: `/keyword edit keyword:hello response:Hey there!`  
**Text equivalent**: `%keyword edit hello "Hey there!"`  
**Permissions**: Manage Server

### `/keyword delete <keyword>`

**Description**: Delete a keyword trigger  
**Usage**: `/keyword delete keyword:hello`  
**Text equivalent**: `%keyword delete hello`  
**Permissions**: Manage Server

### `/keyword list`

**Description**: List this server's keyword triggers  
**Usage**: `/keyword list`  
**Text equivalent**: `%keyword list`  
**Permissions**: Manage Server  
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
**⚠️ **Warning\*\*: This command can execute arbitrary code and should only be used by trusted developers

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

| Error                              | Cause                           | Solution                    |
| ---------------------------------- | ------------------------------- | --------------------------- |
| "You must be in a voice channel"   | User not in voice channel       | Join a voice channel first  |
| "I cannot join that voice channel" | Missing permissions             | Check bot voice permissions |
| "Command failed"                   | Various issues                  | Check bot logs for details  |
| "Not found"                        | Invalid keyword/starboard index | Verify the item exists      |
| "Permission denied"                | Insufficient permissions        | Check user/bot permissions  |

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
