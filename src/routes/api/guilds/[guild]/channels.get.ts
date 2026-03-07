import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { ChannelType } from 'discord.js';
import { resolveGuild } from '../_helpers';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/channels' });
	}

	public override run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const typeFilter = (request.query as any)?.type;
		const channels = guild.channels.cache.filter((c) => {
			if (typeFilter === 'voice') return c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice;
			if (typeFilter === 'text') return c.type === ChannelType.GuildText;
			return true;
		});

		return response.json(
			Array.from(channels.values()).map((c) => ({
				id: c.id,
				name: c.name,
				type: c.type
			}))
		);
	}
}
