import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';
import { handleMemberJoin } from '../lib/antiRaidActions';

/**
 * Join-rate detection and new-member screening (LYRA-12). Discord only sends this event with the
 * Server Members intent, which Lyra requests when DISCORD_MEMBERS_INTENT is set; without it this
 * listener simply never fires.
 */
@ApplyOptions<Listener.Options>({ event: Events.GuildMemberAdd })
export class AntiRaidJoinListener extends Listener<typeof Events.GuildMemberAdd> {
	public override run(member: GuildMember) {
		return handleMemberJoin(member);
	}
}
