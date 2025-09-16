[![Deployment Status](https://github.com/masonbesmer/lyra-sapphire/actions/workflows/deployment.yml/badge.svg?branch=main)](https://github.com/masonbesmer/lyra-sapphire/actions/workflows/deployment.yml)

# TypeScript Sapphire Bot example with Tsup

This is a basic setup of a Discord bot using the [sapphire framework][sapphire] written in TypeScript

## How to use it?

### Prerequisite

```sh
npm install
```

### Development

This example can be run with `tsup` to watch the files and automatically restart your bot.

```sh
npm run dev
```

### Production

You can also run the bot with `npm dev`, this will first build your code and then run `node ./dist/index.js`. But this is not the recommended way to run a bot in production.

### Database

The bot uses a SQLite database to store various data. When the bot starts it
will create the database file and required tables if they do not already exist.
By default the database is located at `./data/word_triggers.db`. You can change
this location by setting the `SQLITE_PATH` variable in your `.env` file.

#### Database Tables

- **`word_triggers`**: Stores keyword trigger responses
- **`player_messages`**: Stores currently playing message IDs for cleanup
- **`command_permissions`**: Stores command role requirements for the permissions system

### Permissions System

Lyra includes a Discord role-based permissions system that is backwards compatible:

- **Default**: All commands are accessible to all users
- **Role-Based**: Commands can optionally require specific Discord roles
- **Management**: Only bot owners can modify permissions via `/permissions` command

See [PERMISSIONS.md](PERMISSIONS.md) for detailed usage instructions.

Music playback is configured with a `bufferingTimeout` of `0` to make
transitions between songs as seamless as possible.

## License

Dedicated to the public domain via the [Unlicense], courtesy of the Sapphire Community and its contributors.

[sapphire]: https://github.com/sapphiredev/framework
[unlicense]: https://github.com/sapphiredev/examples/blob/main/LICENSE.md
