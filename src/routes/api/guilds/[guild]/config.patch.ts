import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild } from '../_helpers';
import { getMusicConfig, setMusicConfig } from '../../../../lib/config';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/config' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		// Only guild admins can update config
		if (!resolved.member.permissions.has('ManageGuild')) {
			return response.error(HttpCodes.Forbidden);
		}

		const body = request.body as Partial<{ dj_role_id: string | null; default_volume: number; announce_tracks: boolean }> | null;
		if (!body) return response.error(HttpCodes.BadRequest);

		setMusicConfig({ guild_id: guildId, ...body });
		return response.json(getMusicConfig(guildId));
	}
}
