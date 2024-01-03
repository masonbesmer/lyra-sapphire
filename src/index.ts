import { ApplicationCommandRegistries, RegisterBehavior } from '@sapphire/framework';
import { LyraClient } from './LyraClient';

ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.BulkOverwrite);

ApplicationCommandRegistries.setDefaultGuildIds(['1095120417854865429']);

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

main();
