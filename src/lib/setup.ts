// Unless explicitly defined, set NODE_ENV as development:
process.env.NODE_ENV ??= 'development';

import { ApplicationCommandRegistries, RegisterBehavior } from '@sapphire/framework';
import '@sapphire/plugin-api/register';
import '@sapphire/plugin-editable-commands/register';
import '@sapphire/plugin-logger/register';
import '@sapphire/plugin-subcommands/register';
import { setup, type ArrayString } from '@skyra/env-utilities';
import * as colorette from 'colorette';
import { join } from 'path';
import { inspect } from 'util';
import { srcDir } from './constants';

// Read env var
setup({ path: join(srcDir, '.env') });

// Set default behavior to bulk overwrite
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.BulkOverwrite);
// Docker Compose defines the variable as an empty string when it is unset on the host, and
// ''.split(',') yields [''] — a non-empty array of a blank guild id. That routes every command
// into a guild bucket keyed by '', which wipes the global commands and then fails to register.
ApplicationCommandRegistries.setDefaultGuildIds(
	(process.env.BULK_OVERWRITE_GUILD_IDS ?? '')
		.split(',')
		.map((guildId) => guildId.trim())
		.filter((guildId) => guildId.length > 0)
);

// Set default inspection depth
inspect.defaultOptions.depth = 1;

// Enable colorette
colorette.createColors({ useColor: true });

declare module '@skyra/env-utilities' {
	interface Env {
		OWNERS: ArrayString;
		/**
		 * Optional path to the SQLite database file. If omitted, the
		 * bot will use a default path and create the file as needed.
		 */
		SQLITE_PATH?: string;
	}
}
