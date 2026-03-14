# Quick Start: Testing Lavalink Music System

This guide will help you quickly test the Lavalink music system on your local development environment.

## Prerequisites

Before you begin, ensure you have:

- ✅ Docker installed and running
- ✅ Node.js 22.x installed
- ✅ Yarn 4 (via Corepack)
- ✅ Discord bot token ready

## Step 1: Start Lavalink (5 minutes)

The project includes a pre-configured Lavalink setup for development.

```bash
# Start Lavalink server
docker-compose -f docker-compose.lavalink.yml up -d

# Verify it's running
docker ps

# Check logs (optional)
docker-compose -f docker-compose.lavalink.yml logs -f lavalink
```

You should see Lavalink starting up on port 2333. Wait about 10-20 seconds for it to fully initialize.

**Verify Lavalink is running:**

```bash
curl http://localhost:2333/version
```

Expected output: `{"version":"4.0.8",...}`

## Step 2: Configure the Bot

```bash
# Copy example environment file
cp src/.env.example src/.env

# Edit src/.env with your Discord bot token
# The Lavalink settings are already pre-configured for local development
```

Your `src/.env` should have:

```env
DISCORD_TOKEN=your_bot_token_here
OWNERS=your_user_id_here

# These are already set correctly for local dev
LAVALINK_NODE_NAME=main
LAVALINK_HOST=localhost:2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=false
```

## Step 3: Install Dependencies & Start Bot

```bash
# Enable Corepack
corepack enable

# Install dependencies
yarn install

# Start in development mode
yarn dev
```

The bot should connect to Discord AND Lavalink. Look for logs like:

```
[Kazagumo] Player created for guild: ...
```

## Step 4: Test Music Commands

Join a voice channel in Discord, then test these commands:

### Basic Test

```
%play never gonna give you up
```

or

```
/play query:never gonna give you up
```

If music starts playing, **everything is working!** 🎉

### Additional Tests

```
# View the queue
%queue

# Skip to next song
%skip

# Pause/resume
%pause

# Show now playing
%nowplaying

# Stop and clear queue
%stop

# Search for songs
%search rick astley

# View history
%history
```

## Troubleshooting

### ❌ "Lavalink connection failed"

**Solution:**

```bash
# Check if Lavalink is running
docker ps | grep lavalink

# Restart Lavalink
docker-compose -f docker-compose.lavalink.yml restart

# Check logs for errors
docker-compose -f docker-compose.lavalink.yml logs lavalink
```

### ❌ "No results found" or YouTube errors

**Solution:**

- Try a direct link: `%play https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- Try SoundCloud: `%play scsearch:songname`
- Check Lavalink logs for YouTube rate limiting

### ❌ Music commands don't respond

**Solution:**

1. Verify bot has permission to join voice channels
2. Make sure you're in a voice channel before using commands
3. Check bot logs for errors
4. Ensure `InVoiceWithBot` precondition is working

### ❌ Audio plays but sounds robotic/stuttering

**Solution:**

- Increase buffer in `lavalink/application.yml`:
    ```yaml
    bufferDurationMs: 800
    frameBufferDurationMs: 2000
    ```
- Restart Lavalink after config changes

### ❌ Port 2333 already in use

**Solution:**

```bash
# Windows
netstat -ano | findstr :2333

# Linux/Mac
lsof -i :2333

# Change port in docker-compose.lavalink.yml if needed
ports:
  - "2334:2333"

# Update LAVALINK_HOST in src/.env
LAVALINK_HOST=localhost:2334
```

## Clean Up

When you're done testing:

```bash
# Stop Lavalink
docker-compose -f docker-compose.lavalink.yml down

# Stop bot
# Press Ctrl+C in the terminal running yarn dev
```

## Next Steps

Once basic testing works:

1. ✅ Test advanced features (filters, loops, queue management)
2. ✅ Test edge cases (playlist imports, long queue, etc.)
3. ✅ Test player message cleanup on restart
4. ✅ Review [LAVALINK.md](./LAVALINK.md) for production deployment
5. ✅ Read [DEVELOPMENT.md](./DEVELOPMENT.md) for architecture details

## Quick Reference

### Useful Commands

```bash
# Lavalink Management
docker-compose -f docker-compose.lavalink.yml up -d      # Start
docker-compose -f docker-compose.lavalink.yml down       # Stop
docker-compose -f docker-compose.lavalink.yml restart    # Restart
docker-compose -f docker-compose.lavalink.yml logs -f    # View logs

# Bot Development
yarn dev          # Start with hot reload
yarn build        # Build for production
yarn start        # Start production build
yarn format       # Format code

# Debug Lavalink
curl http://localhost:2333/version                                          # Check version
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/stats    # Get stats
```

### Important Files

- `lavalink/application.yml` - Lavalink configuration
- `docker-compose.lavalink.yml` - Docker setup for Lavalink
- `src/.env` - Bot environment variables
- `LAVALINK.md` - Comprehensive Lavalink guide

## Support

For more detailed information:

- See [LAVALINK.md](./LAVALINK.md) for comprehensive Lavalink documentation
- See [DEVELOPMENT.md](./DEVELOPMENT.md) for development workflow
- See [COMMANDS.md](./COMMANDS.md) for all available commands
