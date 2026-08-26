import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveGuild } from '../_helpers';
import { getMusicConfig } from '../../../../lib/config';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;

		return response.json(getMusicConfig(resolved.guild.id));
	}
}
