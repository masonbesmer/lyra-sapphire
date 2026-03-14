# Lavalink Setup Guide

This guide explains how to set up and test Lavalink for the Lyra music system. Lavalink is an audio delivery system that handles music playback from various sources (YouTube, SoundCloud, etc.).

## Overview

Lyra uses the following stack for music playback:

- **Lavalink**: Standalone audio server (Java-based)
- **Shoukaku** (v4.3.0): Lavalink client library
- **Kazagumo** (v3.4.3): Player management wrapper around Shoukaku

## Prerequisites

- **Docker** (recommended) or **Java 17+** for running Lavalink
- **Node.js 22.x** for running the bot
- **FFmpeg** (Lavalink requires this for audio processing)

## Local Development Setup

### Option 1: Docker (Recommended)

#### 1. Create Lavalink Configuration

Create `lavalink/application.yml` in your project root:

```yaml
server:
    port: 2333
    address: 0.0.0.0

lavalink:
    server:
        password: 'youshallnotpass'
        sources:
            youtube: false # Disable built-in source; use youtube-source plugin below
            bandcamp: true
            soundcloud: true
            twitch: true
            vimeo: true
            http: true
            local: false

        # Buffer configuration for improved playback stability
        bufferDurationMs: 400
        frameBufferDurationMs: 5000
        youtubePlaylistLoadLimit: 6
        playerUpdateInterval: 5
        youtubeSearchEnabled: true
        soundcloudSearchEnabled: true

    plugins:
        - dependency: 'dev.lavalink.youtube:youtube-plugin:1.18.0'
          snapshot: false

plugins:
    youtube:
        enabled: true
        allowSearch: true
        allowDirectVideoIds: true
        allowDirectPlaylistIds: true
        clients:
            - MUSIC
            - WEB
            - TVHTML5_SIMPLY
            - ANDROID_VR
        clientOptions:
            MUSIC:
                playback: false

metrics:
    prometheus:
        enabled: false
        endpoint: /metrics

sentry:
    dsn: ''
    environment: ''

logging:
    file:
        path: ./logs/

    level:
        root: INFO
        lavalink: INFO

    logback:
        rollingpolicy:
            max-file-size: 1GB
            max-history: 30
```

#### 2. Create docker-compose.lavalink.yml

Create a Docker Compose file for Lavalink:

```yaml
version: '3.8'

services:
    lavalink:
        image: ghcr.io/lavalink-devs/lavalink:4.0.8
        container_name: lavalink
        restart: unless-stopped
        ports:
            - '2333:2333'
        volumes:
            - ./lavalink/application.yml:/opt/Lavalink/application.yml:ro
            - ./lavalink/logs:/opt/Lavalink/logs
        environment:
            - _JAVA_OPTIONS=-Xmx512M
            - SERVER_PORT=2333
            - LAVALINK_SERVER_PASSWORD=youshallnotpass
        networks:
            - lavalink

networks:
    lavalink:
        driver: bridge
```

#### 3. Start Lavalink

```bash
# Create the lavalink directory if it doesn't exist
mkdir -p lavalink/logs

# Start Lavalink
docker-compose -f docker-compose.lavalink.yml up -d

# View logs
docker-compose -f docker-compose.lavalink.yml logs -f lavalink

# Stop Lavalink
docker-compose -f docker-compose.lavalink.yml down
```

Lavalink will be available at `http://localhost:2333`.

### Option 2: Standalone Java Installation

#### 1. Download Lavalink

```bash
# Create Lavalink directory
mkdir lavalink
cd lavalink

# Download the latest Lavalink JAR (v4.0.8)
curl -L -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.0.8/Lavalink.jar

# Create application.yml (use the config from Option 1)
```

#### 2. Start Lavalink

```bash
cd lavalink
java -jar Lavalink.jar
```

Lavalink will start on port 2333 by default.

## Bot Configuration

### 1. Update Environment Variables

Add the following to your `src/.env` file:

```env
# Lavalink Configuration
LAVALINK_NODE_NAME=main
LAVALINK_HOST=localhost:2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=false

# Optional Shoukaku tuning
# LAVALINK_RECONNECT_TRIES=5
# LAVALINK_RECONNECT_INTERVAL=3000
# LAVALINK_REST_TIMEOUT=30000
```

For production or secure connections (WSS):

```env
LAVALINK_HOST=your-lavalink-server.com:443
LAVALINK_SECURE=true
```

### 2. Start the Bot

```bash
# Development mode with hot reload
yarn dev

# Or build and start
yarn build
yarn start
```

## Testing Music Commands

Once both Lavalink and the bot are running, test the music system:

### Basic Commands

```
# Join a voice channel first, then:

# Play a song
%play never gonna give you up
/play query:never gonna give you up

# Check queue
%queue
/queue

# Skip song
%skip
/skip

# Pause/resume
%pause
/pause

# Stop and clear queue
%stop
/stop

# View now playing
%nowplaying
/nowplaying

# Set volume (0-200)
%volume 80
/volume level:80

# Loop modes
%loop track
%loop queue
%loop off
```

### Advanced Commands

```
# Search for songs
%search rick astley
/search query:rick astley

# Skip to specific position
%skipto 3
/skipto position:3

# Remove song from queue
%remove 2
/remove position:2

# Shuffle queue
%shuffle
/shuffle

# Show playback history
%history
/history

# Apply audio filters
%filter bassboost
/filter name:bassboost
```

## Troubleshooting

### Lavalink Not Starting

**Problem**: Lavalink container keeps restarting or fails to start.

**Solutions**:

- Check logs: `docker-compose -f docker-compose.lavalink.yml logs lavalink`
- Ensure port 2333 is not in use: `netstat -an | grep 2333` (Windows: `netstat -an | findstr 2333`)
- Verify `application.yml` syntax is correct
- Ensure Java 17+ is installed (if running standalone)

### Bot Cannot Connect to Lavalink

**Problem**: Bot logs show connection errors or music commands don't work.

**Solutions**:

- Verify Lavalink is running: `curl http://localhost:2333/version`
- Check environment variables in `src/.env` match Lavalink config
- Ensure password matches between bot config and Lavalink `application.yml`
- Check bot logs for connection errors
- Verify firewall isn't blocking port 2333

### Music Not Playing

**Problem**: Commands work but no audio plays.

**Solutions**:

- Ensure FFmpeg is installed on the system running Lavalink
- Check Lavalink logs for errors when trying to play
- Verify the bot has permission to join voice channels
- Try a direct YouTube link: `%play https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- Check if the source is enabled in `application.yml` (YouTube, SoundCloud, etc.)

### YouTube Playback Issues

**Problem**: YouTube links fail or give HTTP 403 errors.

**Solutions**:

- Update to the latest Lavalink version
- Add YouTube source plugins if the default extractor is blocked
- Consider using alternative sources (SoundCloud, Bandcamp)
- Check Lavalink logs for specific YouTube errors

### Connection Drops or Stuttering

**Problem**: Audio cuts out or connection drops frequently.

**Solutions**:

- Increase buffer sizes in `application.yml`:
    ```yaml
    bufferDurationMs: 800
    frameBufferDurationMs: 2000
    ```
- Check network latency between bot and Lavalink
- Ensure adequate resources (CPU/RAM) for Lavalink container
- Adjust Java heap size: `-Xmx1G` for more memory

## Production Deployment

### Deploying Lavalink to Production

For production environments, consider:

1. **Use a VPS or Cloud Provider**:
    - Deploy Lavalink on a low-latency server
    - Use a server with good network connectivity
    - Minimum: 1 CPU, 512MB RAM (1GB+ recommended)

2. **Enable HTTPS/WSS**:

    ```env
    LAVALINK_HOST=lavalink.yourdomain.com:443
    LAVALINK_SECURE=true
    ```

3. **Use Strong Passwords**:

    ```yaml
    lavalink:
        server:
            password: 'your-strong-secure-password-here'
    ```

4. **Add Monitoring**:
    - Enable Prometheus metrics in `application.yml`
    - Monitor CPU, memory, and connection count
    - Set up alerts for downtime

5. **Reverse Proxy Setup** (Optional):
   Use Nginx or Caddy to proxy Lavalink with SSL:

    ```nginx
    upstream lavalink {
        server localhost:2333;
    }

    server {
        listen 443 ssl http2;
        server_name lavalink.yourdomain.com;

        ssl_certificate /path/to/cert.pem;
        ssl_certificate_key /path/to/key.pem;

        location / {
            proxy_pass http://lavalink;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "Upgrade";
            proxy_set_header Host $host;
        }
    }
    ```

### Full Stack Docker Compose (Production)

Create `docker-compose.prod.yml` with both Lavalink and the bot:

```yaml
version: '3.8'

services:
    lavalink:
        image: ghcr.io/lavalink-devs/lavalink:4.0.8
        container_name: lavalink
        restart: unless-stopped
        ports:
            - '2333:2333'
        volumes:
            - ./lavalink/application.yml:/opt/Lavalink/application.yml:ro
            - ./lavalink/logs:/opt/Lavalink/logs
        environment:
            - _JAVA_OPTIONS=-Xmx1G
            - SERVER_PORT=2333
            - LAVALINK_SERVER_PASSWORD=${LAVALINK_PASSWORD}
        networks:
            - lyra-network
        healthcheck:
            test: ['CMD', 'curl', '-f', 'http://localhost:2333/version']
            interval: 30s
            timeout: 10s
            retries: 3
            start_period: 40s

    lyra-bot:
        build: .
        container_name: lyra-bot
        restart: unless-stopped
        depends_on:
            lavalink:
                condition: service_healthy
        environment:
            - DISCORD_TOKEN=${DISCORD_TOKEN}
            - OWNERS=${OWNERS}
            - LAVALINK_NODE_NAME=main
            - LAVALINK_HOST=lavalink:2333
            - LAVALINK_PASSWORD=${LAVALINK_PASSWORD}
            - LAVALINK_SECURE=false
            - NODE_ENV=production
        volumes:
            - ./data:/app/data
            - ./recordings:/app/recordings
        networks:
            - lyra-network

networks:
    lyra-network:
        driver: bridge
```

Start with:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Checking Lavalink Status

### Health Check Endpoints

```bash
# Check version
curl http://localhost:2333/version

# Check node stats (requires auth header)
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/stats

# Check active players
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/sessions
```

### Bot Logs

The bot logs Kazagumo/Shoukaku events:

- `[Kazagumo] Player created for guild: <id>` - Player started
- `[Kazagumo] Player destroyed for guild: <id>` - Player stopped
- Connection errors will be logged with details

## Further Resources

- [Lavalink Official Docs](https://lavalink.dev/)
- [Lavalink GitHub](https://github.com/lavalink-devs/Lavalink)
- [Shoukaku Documentation](https://github.com/Deivu/Shoukaku)
- [Kazagumo Documentation](https://github.com/Takiyo0/Kazagumo)

## Getting Help

If you encounter issues not covered in this guide:

1. Check Lavalink logs for errors
2. Check bot logs for connection/player errors
3. Verify all configuration matches between bot and Lavalink
4. Ensure all prerequisites (FFmpeg, Java, Docker) are properly installed
5. Try with a fresh configuration file from this guide
