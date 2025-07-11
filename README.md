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

### Keyword triggers database

Word trigger responses are stored in a SQLite database. When the bot starts it
will create the database file and the `word_triggers` table if they do not
already exist. By default the database is located at
`./data/word_triggers.db`. You can change this location by setting the
`SQLITE_PATH` variable in your `.env` file.

Playback controls also store the ID of the currently playing message in a
`player_messages` table so leftover messages can be cleaned up when the bot
starts.

## License

Dedicated to the public domain via the [Unlicense], courtesy of the Sapphire Community and its contributors.

[sapphire]: https://github.com/sapphiredev/framework
[unlicense]: https://github.com/sapphiredev/examples/blob/main/LICENSE.md
