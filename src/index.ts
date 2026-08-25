import { LyraClient } from './LyraClient';
import { startListenerClient } from './lib/voice/listenerClient';

import './lib/setup';

const client = new LyraClient();

const main = async () => {
	try {
		client.logger.info('Logging in');
		await client.login();
		client.logger.info('logged in');
		// Voice receive runs on its own gateway client. Missing token disables receive
		// rather than failing startup, so the bot still serves music without it.
		await startListenerClient();
	} catch (error) {
		client.logger.fatal(error);
		await client.destroy();
		process.exit(1);
	}
};

void main();
