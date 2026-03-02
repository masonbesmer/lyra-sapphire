import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import type { QueueMetadata } from '../../../../lib/queueMetadata';
import { resolveGuild } from '../_helpers';
import { getMusicConfig } from '../../../../lib/config';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/play' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const body = request.body as { query?: string; channelId?: string } | null;
		if (!body?.query) return response.error(HttpCodes.BadRequest);

		const auth = request.auth!;
		const userId = (auth.data as any)?.id ?? 'unknown';
		const user = await container.client.users.fetch(userId).catch(() => null);
		if (!user) return response.error(HttpCodes.Unauthorized);

		// Resolve voice channel — use first voice channel in guild or provided channelId
		const channelId = body.channelId;
		const voiceChannel = channelId
			? (guild.channels.cache.get(channelId) ?? null)
			: guild.channels.cache.find((c) => c.isVoiceBased()) ?? null;

		if (!voiceChannel || !voiceChannel.isVoiceBased()) {
			return response.error(HttpCodes.BadRequest);
		}

		const player = useMainPlayer();
		const cfg = getMusicConfig(guildId);
		const meta: QueueMetadata = { interaction: null, channelId: voiceChannel.id, requestedBy: user };

		try {
			const { track } = await player.play(voiceChannel as any, body.query, {
				requestedBy: user,
				nodeOptions: { metadata: meta, volume: cfg.default_volume }
			});
			return response.json({ ok: true, track: { title: track.title, url: track.url } });
		} catch (e) {
			container.logger.error(`[API/play] ${String(e)}`);
			return response.error(HttpCodes.InternalServerError);
		}
	}
}
