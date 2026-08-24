import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { PLAYER_META_KEY, type PlayerMeta } from '../../../../lib/queueMetadata';
import { resolveGuild, readJsonBody } from '../_helpers';
import { getMusicConfig } from '../../../../lib/config';
import { getActiveFilters } from '../../../../lib/lavalinkFilters';
import { searchTracks } from '../../../../lib/musicCommandHelpers';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;
		const { guild } = resolved;

		const body = await readJsonBody<{ query?: string; channelId?: string }>(request);
		if (!body?.query || !body?.channelId) return response.error(HttpCodes.BadRequest, 'Missing a track or a voice channel.');

		const auth = request.auth!;
		const user = await container.client.users.fetch(auth.id).catch(() => null);
		if (!user) return response.error(HttpCodes.Unauthorized, 'Your session expired - log in again.');

		const voiceChannel = guild.channels.cache.get(body.channelId);
		if (!voiceChannel?.isVoiceBased()) {
			return response.error(HttpCodes.BadRequest, 'That channel is not a voice channel.');
		}

		if (resolved.member.voice.channelId !== voiceChannel.id) {
			return response.error(HttpCodes.Forbidden, `Join #${voiceChannel.name} in Discord before queueing there.`);
		}

		const kazagumo = container.client.kazagumo;
		const cfg = getMusicConfig(guildId);

		try {
			const result = await searchTracks(kazagumo, body.query, { requester: user });
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
			// KazagumoQueue#add shifts the first entry off the array it is handed when nothing is
			// currently playing, so snapshot the track we report before queueing it.
			const [queuedTrack] = tracksToAdd;
			player.queue.add(tracksToAdd);
			if (!player.playing && !player.paused) await player.play();

			return response.json({ ok: true, track: { title: queuedTrack.title, url: queuedTrack.uri ?? null } });
		} catch (e) {
			container.logger.error(`[API/play] ${String(e)}`);
			return response.error(HttpCodes.InternalServerError, 'The bot failed to queue that track - check its logs.');
		}
	}
}
