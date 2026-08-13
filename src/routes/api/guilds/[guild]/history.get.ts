import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild } from '../_helpers';
import { getPlayHistory } from '../../../../lib/musicHistory';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		const page = parseInt((request.query as any)?.page ?? '1') || 1;
		const limit = parseInt((request.query as any)?.limit ?? '20') || 20;
		const offset = (page - 1) * Math.min(limit, 100);

		const rows = getPlayHistory(guildId, Math.min(limit, 100), offset);
		return response.json({ page, rows });
	}
}
