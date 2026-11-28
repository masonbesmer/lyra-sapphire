import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { AutoModerationActionExecution } from 'discord.js';
import { handleNativeExecution } from '../lib/automodActions';

/** One of Lyra's native AutoMod rules fired: apply the filter's own action (warn, timeout, ...). */
@ApplyOptions<Listener.Options>({ event: Events.AutoModerationActionExecution })
export class AutomodExecution extends Listener<typeof Events.AutoModerationActionExecution> {
	public override run(execution: AutoModerationActionExecution) {
		return handleNativeExecution(execution);
	}
}
