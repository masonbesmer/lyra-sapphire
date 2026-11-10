import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveGuild } from '../_helpers';
import { serializeSummary } from '../_playlists';
import { listVisiblePlaylists, type VisiblePlaylist } from '../../../../lib/playlists';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;
		const { guild } = resolved;

		const lists = await listVisiblePlaylists(guild, request.auth!.id);
		const serialize = (section: VisiblePlaylist[]) =>
			Promise.all(section.map(({ playlist, access }) => serializeSummary(playlist, access, guild.id)));

		return response.json({
			owned: await serialize(lists.owned),
			shared: await serialize(lists.shared),
			public: await serialize(lists.public),
			publicIncomplete: lists.publicIncomplete
		});
	}
}
