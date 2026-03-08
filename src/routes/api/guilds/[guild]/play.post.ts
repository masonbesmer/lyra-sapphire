import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { PLAYER_META_KEY, type PlayerMeta } from '../../../../lib/queueMetadata';
import { resolveGuild } from '../_helpers';
import { getMusicConfig } from '../../../../lib/config';
import { getActiveFilters } from '../../../../lib/lavalinkFilters';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/play' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const body = request.body as { query?: string; channelId?: string } | null;
		if (!body?.query || !body?.channelId) return response.error(HttpCodes.BadRequest);

		const auth = request.auth!;
		const userId = (auth.data as any)?.id ?? 'unknown';
		const user = await container.client.users.fetch(userId).catch(() => null);
		if (!user) return response.error(HttpCodes.Unauthorized);

		const voiceChannel = guild.channels.cache.get(body.channelId);
		if (!voiceChannel?.isVoiceBased()) {
			return response.error(HttpCodes.BadRequest);
		}

		const kazagumo = container.client.kazagumo;
		const cfg = getMusicConfig(guildId);

		try {
			const result = await kazagumo.search(body.query, { requester: user });
			if (!result.tracks.length) return response.json({ ok: false, error: 'No results found' });

			let player = kazagumo.getPlayer(guildId);
			if (!player) {
				player = await kazagumo.createPlayer({
					guildId,
					voiceId: voiceChannel.id,
					textId: voiceChannel.id,
					deaf: true,
					volume: cfg.default_volume
				});
			}

			const meta: PlayerMeta = { interaction: null, channelId: voiceChannel.id, requestedBy: user };
			player.data.set(PLAYER_META_KEY, meta);
			if (!player.data.has('activeFilters')) player.data.set('activeFilters', getActiveFilters(player));

			const tracksToAdd = result.type === 'PLAYLIST' ? result.tracks : [result.tracks[0]];
			player.queue.add(tracksToAdd);
			if (!player.playing && !player.paused) await player.play();

			return response.json({ ok: true, track: { title: tracksToAdd[0].title, url: tracksToAdd[0].uri ?? null } });
		} catch (e) {
			container.logger.error(`[API/play] ${String(e)}`);
			return response.error(HttpCodes.InternalServerError);
		}
	}
}
