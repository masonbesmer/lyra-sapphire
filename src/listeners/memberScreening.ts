import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { GuildMember, PartialGuildMember } from 'discord.js';
import { onMemberScreeningPassed } from '../lib/selfRoleActions';

/** Auto-roles wait until a member accepts the server rules (membership screening). */
@ApplyOptions<Listener.Options>({ event: Events.GuildMemberUpdate })
export class MemberScreeningListener extends Listener<typeof Events.GuildMemberUpdate> {
	public async run(before: GuildMember | PartialGuildMember, after: GuildMember) {
		if (before.pending && !after.pending) await onMemberScreeningPassed(after);
	}
}
