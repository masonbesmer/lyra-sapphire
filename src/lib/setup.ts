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

// Set default behavior to bulk overwrite
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.BulkOverwrite);
ApplicationCommandRegistries.setDefaultGuildIds(process.env.NODE_ENV === 'development' ? ['1095120417854865429'] : ['925192180480491540']);

// Read env var
setup({ path: join(srcDir, '.env') });

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
		/**
		 * Optional development guild ID for command registration.
		 * Defaults to '925192180480491540' if not specified.
		 */
		DEVELOPMENT_GUILD_ID?: string;
	}
}
