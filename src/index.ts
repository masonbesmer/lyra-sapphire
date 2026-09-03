import { LyraClient } from './LyraClient';
import { startMusicClient } from './lib/voice/musicClient';

import './lib/setup';

const client = new LyraClient();

const main = async () => {
	try {
		client.logger.info('Logging in');
		await client.login();
		client.logger.info('logged in');
		// Music runs on its own gateway client so it never fights Lyra's own voice state.
		// Missing token is not fatal: music falls back to this client, as it did before
		// the split.
		await startMusicClient();
	} catch (error) {
		client.logger.fatal(error);
		await client.destroy();
		process.exit(1);
	}
};

void main();
