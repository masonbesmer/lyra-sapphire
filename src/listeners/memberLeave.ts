import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { GuildMember, PartialGuildMember } from 'discord.js';
import { onMemberLeave } from '../lib/selfRoleActions';

/** Remembers sticky roles. Only fires with the Server Members intent (DISCORD_MEMBERS_INTENT=true). */
@ApplyOptions<Listener.Options>({ event: Events.GuildMemberRemove })
export class MemberLeaveListener extends Listener<typeof Events.GuildMemberRemove> {
	public run(member: GuildMember | PartialGuildMember) {
		try {
			onMemberLeave(member);
		} catch (error) {
			this.container.logger.warn(`[selfroles] couldn't save sticky roles for ${member.id}: ${String(error)}`);
		}
	}
}
