import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { runAutomod } from '../lib/automodActions';

@ApplyOptions<Listener.Options>({ event: Events.MessageCreate })
export class AutomodMessageCreate extends Listener<typeof Events.MessageCreate> {
	public override run(message: Message) {
		return runAutomod(message);
	}
}
