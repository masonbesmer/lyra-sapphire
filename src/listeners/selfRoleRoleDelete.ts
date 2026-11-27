import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Role } from 'discord.js';
import { refreshPanel } from '../lib/selfRoleActions';
import { forgetRoleInConfig, forgetRoleInPanels, getPanel } from '../lib/selfRoles';

/** A deleted role drops off every panel, the auto-role list and the sticky list. */
@ApplyOptions<Listener.Options>({ event: Events.GuildRoleDelete })
export class SelfRoleRoleDeleteListener extends Listener<typeof Events.GuildRoleDelete> {
	public async run(role: Role) {
		forgetRoleInConfig(role.guild.id, role.id);
		for (const panelId of forgetRoleInPanels(role.guild.id, role.id)) {
			const panel = getPanel(role.guild.id, panelId);
			if (panel) await refreshPanel(role.guild, panel).catch(() => undefined);
		}
	}
}
