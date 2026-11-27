import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Client, Guild, Invite } from 'discord.js';
import { forgetInvite, primeInvites, rememberInvite } from '../../lib/eventLogPost';

/** Keeps the invite-use snapshot current, so a join can be matched to the invite it used. */

@ApplyOptions<Listener.Options>({ name: 'eventLogInvitesReady', event: Events.ClientReady, once: true })
export class EventLogInvitesReady extends Listener<typeof Events.ClientReady> {
	public async run(client: Client<true>) {
		for (const guild of client.guilds.cache.values()) await primeInvites(guild);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogInvitesGuildCreate', event: Events.GuildCreate })
export class EventLogInvitesGuildCreate extends Listener<typeof Events.GuildCreate> {
	public async run(guild: Guild) {
		await primeInvites(guild);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogInviteCreate', event: Events.InviteCreate })
export class EventLogInviteCreate extends Listener<typeof Events.InviteCreate> {
	public run(invite: Invite) {
		rememberInvite(invite);
	}
}

@ApplyOptions<Listener.Options>({ name: 'eventLogInviteDelete', event: Events.InviteDelete })
export class EventLogInviteDelete extends Listener<typeof Events.InviteDelete> {
	public run(invite: Invite) {
		if (invite.guild) forgetInvite(invite.guild.id, invite.code);
	}
}
