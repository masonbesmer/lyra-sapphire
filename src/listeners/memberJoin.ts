import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';
import { onMemberJoin } from '../lib/selfRoleActions';

/** Sticky roles and auto-role. Needs the privileged GuildMembers intent. */
@ApplyOptions<Listener.Options>({ event: Events.GuildMemberAdd })
export class MemberJoinListener extends Listener<typeof Events.GuildMemberAdd> {
	public async run(member: GuildMember) {
		await onMemberJoin(member);
	}
}
