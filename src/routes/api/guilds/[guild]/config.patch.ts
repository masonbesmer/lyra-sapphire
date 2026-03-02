import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild } from '../_helpers';
import { getMusicConfig, setMusicConfig } from '../../../../lib/config';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/config' });
	}

	public override run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		// Only guild admins can update config
		const auth = request.auth!;
		const userId = (auth.data as any)?.id;
		const member = guild.members.cache.get(userId);
		if (!member?.permissions.has('ManageGuild')) {
			return response.error(HttpCodes.Forbidden);
		}

		const body = request.body as Partial<{ dj_role_id: string | null; default_volume: number; announce_tracks: boolean }> | null;
		if (!body) return response.error(HttpCodes.BadRequest);

		setMusicConfig({ guild_id: guildId, ...body });
		return response.json(getMusicConfig(guildId));
	}
}
