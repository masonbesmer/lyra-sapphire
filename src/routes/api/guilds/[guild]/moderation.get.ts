import { HttpCodes, Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { ChannelType } from 'discord.js';
import { resolveGuild } from '../_helpers';
import { panelView } from '../_moderation';
import { DEFAULT_ANTIRAID, JOIN_ACTIONS, LIMITS, VERIFY_MODES, getAntiRaidConfig, isRaidActive } from '../../../../lib/antiRaid';
import { AUTOMOD_ACTIONS, RULE_DESCRIPTIONS, RULE_LIMITS, RULE_LIST_KEY, getAutomodSettings, getRules } from '../../../../lib/automod';
import { LOG_EVENT_LABELS, LOG_GROUPS, getLogIgnores, getLogRoutes } from '../../../../lib/eventLog';
import { modAccess } from '../../../../lib/modDashboard';
import { ACTION_LABELS, getModConfig } from '../../../../lib/moderation';
import { MODE_HINTS, PANEL_KINDS, PANEL_MODES, getPanels } from '../../../../lib/selfRoles';

/**
 * Everything the Moderation tab needs to render, in one payload: which panels this member may
 * use, plus the settings of each one they can open. Panels they can't use are left out entirely.
 */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;
		const { guild, member } = resolved;

		const access = modAccess(member);
		if (!Object.values(access).some(Boolean)) {
			return response.error(HttpCodes.Forbidden, 'The Moderation tab needs Moderate Members, Manage Server or Manage Roles.');
		}

		const antiraid = access.antiraid ? getAntiRaidConfig(guild.id) : null;

		return response.json({
			access,
			action_labels: ACTION_LABELS,
			roles: Array.from(guild.roles.cache.values())
				.filter((role) => role.id !== guild.id)
				.sort((a, b) => b.position - a.position)
				.map((role) => ({ id: role.id, name: role.name, managed: role.managed })),
			text_channels: Array.from(guild.channels.cache.values())
				.filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
				.sort((a, b) => ('position' in a && 'position' in b ? a.position - b.position : 0))
				.map((channel) => ({ id: channel.id, name: channel.name })),
			mod_log_channel_id: getModConfig(guild.id).log_channel_id,
			logging: access.logging
				? { groups: LOG_GROUPS, labels: LOG_EVENT_LABELS, routes: getLogRoutes(guild.id), ignores: getLogIgnores(guild.id) }
				: null,
			automod: access.automod
				? {
						rules: getRules(guild.id),
						settings: getAutomodSettings(guild.id),
						actions: AUTOMOD_ACTIONS,
						descriptions: RULE_DESCRIPTIONS,
						limits: RULE_LIMITS,
						list_keys: RULE_LIST_KEY
					}
				: null,
			antiraid: antiraid
				? {
						config: antiraid,
						raid_active: isRaidActive(antiraid),
						defaults: DEFAULT_ANTIRAID,
						limits: LIMITS,
						join_actions: JOIN_ACTIONS,
						verify_modes: VERIFY_MODES
					}
				: null,
			panels: access.roles
				? {
						list: getPanels(guild.id).map((panel) => panelView(guild, panel)),
						kinds: PANEL_KINDS,
						modes: PANEL_MODES,
						mode_hints: MODE_HINTS
					}
				: null
		});
	}
}
