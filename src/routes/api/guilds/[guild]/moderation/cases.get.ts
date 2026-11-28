import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveModerator } from '../../_moderation';
import { isModAction, searchCases } from '../../../../../lib/moderation';

/** The case browser: `?q=` (case number, user ID, or text in a reason/tag), `?action=`, `?page=`, `?limit=`. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'cases');
		if (!resolved) return;
		const { guild } = resolved;

		const query = (request.query ?? {}) as Record<string, string | undefined>;
		const page = Math.max(parseInt(query.page ?? '1') || 1, 1);
		const limit = Math.min(Math.max(parseInt(query.limit ?? '25') || 25, 1), 100);
		const action = query.action && isModAction(query.action) ? query.action : null;
		const q = (query.q ?? '').slice(0, 100);

		const { cases, total } = searchCases(guild.id, { query: q, action, limit, offset: (page - 1) * limit });
		return response.json({ page, limit, total, cases });
	}
}
