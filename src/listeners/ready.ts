import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { cleanupStalePlayerMessages } from '../lib/playerMessages';
import { attachWebSocketServer } from '../lib/websocket';
import type { StoreRegistryValue } from '@sapphire/pieces';
import { blue, gray, green, magenta, magentaBright, white, yellow } from 'colorette';

const dev = process.env.NODE_ENV !== 'production';

@ApplyOptions<Listener.Options>({ once: true })
export class UserEvent extends Listener {
	private readonly style = dev ? yellow : blue;

	public override run() {
		this.printBanner();
		this.printStoreDebugInformation();
		void cleanupStalePlayerMessages(this.container.client).catch((err) =>
			this.container.logger.error(`Failed to cleanup messages: ${String(err)}`)
		);

		// Attach WebSocket server if the API plugin is loaded
		try {
			const apiServer = (this.container as any).server;
			if (apiServer?.server) {
				attachWebSocketServer(apiServer.server);
				this.container.logger.info('WebSocket server attached to HTTP server');
			}
		} catch (err) {
			this.container.logger.warn(`Could not attach WebSocket server: ${String(err)}`);
		}
	}

	private printBanner() {
		const success = green('+');

		const llc = dev ? magentaBright : white;
		const blc = dev ? magenta : blue;

		const line01 = llc('');
		const line02 = llc('');
		const line03 = llc('');

		// Offset Pad
		const pad = ' '.repeat(7);

		console.log(
			String.raw`
${line01} ${pad}${blc('1.0.0')}
${line02} ${pad}[${success}] Gateway
${line03}${dev ? ` ${pad}${blc('<')}${llc('/')}${blc('>')} ${llc('DEVELOPMENT MODE')}` : ''}
		`.trim()
		);
	}

	private printStoreDebugInformation() {
		const { client, logger } = this.container;
		const stores = [...client.stores.values()];
		const last = stores.pop()!;

		for (const store of stores) logger.info(this.styleStore(store, false));
		logger.info(this.styleStore(last, true));
	}

	private styleStore(store: StoreRegistryValue, last: boolean) {
		return gray(`${last ? '└─' : '├─'} Loaded ${this.style(store.size.toString().padEnd(3, ' '))} ${store.name}.`);
	}
}
