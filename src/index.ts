import { ApplicationCommandRegistries, RegisterBehavior } from '@sapphire/framework';
import { LyraClient } from './LyraClient';

ApplicationCommandRegistries.setDefaultGuildIds(['925192180480491540']);
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.Overwrite);
ApplicationCommandRegistries.setBulkOverwriteRetries(3);

import './lib/setup';

const client = new LyraClient();

const main = async () => {
	try {
		client.logger.info('Logging in');
		await client.login();
		client.logger.info('Logged in');
	} catch (error) {
		client.logger.fatal(error);
		client.destroy();
		process.exit(1);
	}
};

void main();
