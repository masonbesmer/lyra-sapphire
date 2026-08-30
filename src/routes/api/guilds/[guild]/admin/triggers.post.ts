import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, readJsonBody, requireAdmin } from '../../_helpers';
import { deleteWordTrigger, getWordTriggers, setWordTrigger } from '../../../../../lib/config';
import { auditActor, recordConfigChange } from '../../../../../lib/audit';

interface Body {
	action: 'set' | 'remove';
	keyword: string;
	response?: string;
}

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;
		if (!requireAdmin(response, resolved.member)) return;

		const body = await readJsonBody<Body>(request);
		if (!body) return response.error(HttpCodes.BadRequest);
		if (body.action !== 'set' && body.action !== 'remove') return response.error(HttpCodes.BadRequest);
		if (typeof body.keyword !== 'string' || body.keyword.trim().length === 0 || body.keyword.length > 100) {
			return response.error(HttpCodes.BadRequest, 'Give me a keyword.');
		}

		const keyword = body.keyword.trim().toLowerCase();
		const actor = auditActor(resolved.member, 'dashboard');
		// The trigger's response is the audited value, so the log shows what the reply used to say.
		const previous = getWordTriggers(resolved.guild.id).find((trigger) => trigger.keyword === keyword)?.response ?? null;

		if (body.action === 'remove') {
			if (deleteWordTrigger(resolved.guild.id, keyword)) {
				recordConfigChange(resolved.guild.id, actor, 'triggers', keyword, previous, null);
			}
			return response.json(getWordTriggers(resolved.guild.id));
		}

		if (typeof body.response !== 'string' || body.response.trim().length === 0 || body.response.length > 2000) {
			return response.error(HttpCodes.BadRequest, 'Give me a response of 1-2000 characters.');
		}

		setWordTrigger(resolved.guild.id, keyword, body.response.trim());
		recordConfigChange(resolved.guild.id, actor, 'triggers', keyword, previous, body.response.trim());
		return response.json(getWordTriggers(resolved.guild.id));
	}
}
