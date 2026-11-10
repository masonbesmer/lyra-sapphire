import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { readJsonBody } from '../../../_helpers';
import { loadPlaylist } from '../../../_playlists';
import { playPlaylist } from '../../../../../../lib/playlistPlayback';

interface Body {
	channelId?: unknown;
	shuffle?: unknown;
	loop?: unknown;
	repeat?: unknown;
}

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'read');
		if (!loaded) return;
		const { guild, member, playlist } = loaded;

		const body = await readJsonBody<Body>(request);
		if (typeof body?.channelId !== 'string') return response.error(HttpCodes.BadRequest, 'Missing a voice channel.');

		const voiceChannel = guild.channels.cache.get(body.channelId);
		if (!voiceChannel?.isVoiceBased()) return response.error(HttpCodes.BadRequest, 'That channel is not a voice channel.');
		if (member.voice.channelId !== voiceChannel.id) {
			return response.error(HttpCodes.Forbidden, `Join #${voiceChannel.name} in Discord before queueing there.`);
		}

		const result = await playPlaylist({
			guildId: guild.id,
			member,
			voiceChannelId: voiceChannel.id,
			textChannelId: voiceChannel.id,
			interaction: null,
			playlist,
			shuffle: body.shuffle === true,
			loop: body.loop === true,
			repeat: typeof body.repeat === 'number' ? body.repeat : 1
		});
		if (!result.ok) {
			if (result.code === 'bad_input') return response.error(HttpCodes.BadRequest, result.error);
			return response.error(HttpCodes.InternalServerError, 'The bot failed to queue that playlist - check its logs.');
		}
		return response.json({ ok: true, queued: result.data.queued });
	}
}
