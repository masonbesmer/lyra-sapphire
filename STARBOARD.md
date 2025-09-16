# Starboard System

The starboard system allows users to react with ⭐ (star) emojis to messages. When a message receives enough stars, it gets automatically reposted to a designated starboard channel.

## Features

- ⭐ **Automatic Starboard Posting**: Messages that reach the star threshold are automatically posted to the starboard channel
- 🔢 **Unique Indices**: Each starboard entry gets a unique 5-digit alphanumeric index (e.g., `ABC12`, `XYZ89`)
- 📊 **Real-time Updates**: Star counts update in real-time as reactions are added or removed
- 🗑️ **Automatic Cleanup**: Messages that fall below the threshold are automatically removed from the starboard
- 🚫 **Bot Protection**: Bot messages cannot be starred
- 🔄 **Self-Protection**: Messages from the starboard channel itself cannot be starred
- 🖼️ **Image Support**: Image attachments are displayed in starboard embeds

## Commands

All starboard commands use the prefix `%starboard` followed by a subcommand:

### `%starboard` or `%starboard config`
Shows the current starboard configuration for the server.

**Example:**
```
%starboard config
```

### `%starboard set-channel <#channel>`
Sets the channel where starred messages will be posted.

**Example:**
```
%starboard set-channel #starboard
```

### `%starboard set-threshold <number>`
Sets how many stars are required for a message to be posted to the starboard. Must be between 1 and 50.

**Default:** 3 stars

**Example:**
```
%starboard set-threshold 5
```

### `%starboard list`
Shows a paginated list of all current starboard entries for the server.

**Example:**
```
%starboard list
```

### `%starboard delete <index>`
Deletes a starboard entry by its unique index code. This removes both the database entry and the starboard message.

**Example:**
```
%starboard delete ABC12
```

## How It Works

1. **Setup**: Use `%starboard set-channel` to designate a starboard channel
2. **Configuration**: Optionally set a custom threshold with `%starboard set-threshold`
3. **Usage**: Users react with ⭐ to messages they like
4. **Automatic Posting**: When a message reaches the threshold, it's automatically posted to the starboard
5. **Management**: Use `%starboard list` and `%starboard delete` to manage entries

## Database Schema

The starboard system uses two database tables:

### `starboard_config`
Stores per-guild configuration:
- `guild_id`: Discord guild ID
- `channel_id`: Starboard channel ID
- `threshold`: Required star count (default: 3)

### `starboard_messages`
Tracks starboard entries:
- `id`: Unique identifier
- `guild_id`: Discord guild ID
- `original_message_id`: ID of the original message
- `original_channel_id`: ID of the original channel
- `starboard_message_id`: ID of the starboard message
- `star_count`: Current star count
- `index_code`: Unique 5-digit alphanumeric index

## Technical Details

- The system listens for `messageReactionAdd` and `messageReactionRemove` events
- Only ⭐ (star) emoji reactions are processed
- The system handles partial messages and reactions gracefully
- Unique indices are generated using alphanumeric characters (A-Z, 0-9)
- Database operations use prepared statements for security and performance