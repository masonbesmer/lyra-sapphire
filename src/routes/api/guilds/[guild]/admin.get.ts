import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { ChannelType } from 'discord.js';
import { resolveGuild, requireAdmin } from '../_helpers';
import { getCommandPermissions, getMusicConfig, getVoiceAssistantConfig, getWordTriggers } from '../../../../lib/config';
import { getStarboardBlacklist, getStarboardConfig } from '../../../../lib/starboard';

/**
 * The whole server-configuration surface in one payload, so the dashboard's Config tab
 * renders from a single request instead of fanning out to one route per settings group.
 */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;
		const { guild, member } = resolved;
		if (!requireAdmin(response, member)) return;

		const blacklist = getStarboardBlacklist(guild.id).map((entry) => ({
			...entry,
			// Best-effort label only - an uncached user or a deleted channel falls back to the raw ID.
			name:
				entry.target_type === 'channel'
					? (guild.channels.cache.get(entry.target_id)?.name ?? entry.target_id)
					: (guild.members.cache.get(entry.target_id)?.user.username ?? entry.target_id)
		}));

		return response.json({
			music: getMusicConfig(guild.id),
			starboard: getStarboardConfig(guild.id),
			starboard_blacklist: blacklist,
			voice: getVoiceAssistantConfig(guild.id),
			command_permissions: getCommandPermissions(guild.id),
			word_triggers: getWordTriggers(),
			roles: Array.from(guild.roles.cache.values())
				.filter((role) => role.id !== guild.id)
				.sort((a, b) => b.position - a.position)
				.map((role) => ({ id: role.id, name: role.name })),
			text_channels: Array.from(guild.channels.cache.values())
				.filter((channel) => channel.type === ChannelType.GuildText)
				.map((channel) => ({ id: channel.id, name: channel.name })),
			commands: Array.from(container.stores.get('commands').keys()).sort()
		});
	}
}
