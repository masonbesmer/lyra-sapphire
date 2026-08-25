import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { resolveGuild, readJsonBody } from '../_helpers';
import * as musicActions from '../../../../lib/musicActions';

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

		const result = await musicActions.play(guildId, resolved.member, body.query, voiceChannel.id);
		if (!result.ok) {
			switch (result.code) {
				case 'no_results':
					return response.json({ ok: false, error: 'No results found' });
				case 'bad_input':
					return response.error(HttpCodes.BadRequest);
				default:
					return response.error(HttpCodes.InternalServerError, 'The bot failed to queue that track - check its logs.');
			}
		}

		return response.json({ ok: true, track: { title: result.data.title, url: result.data.url } });
	}
}
