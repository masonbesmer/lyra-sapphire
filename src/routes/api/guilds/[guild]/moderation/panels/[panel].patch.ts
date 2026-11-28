import { HttpCodes, Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { readJsonBody } from '../../../_helpers';
import { panelView, resolveModerator, sendFailure } from '../../../_moderation';
import { auditActor } from '../../../../../../lib/audit';
import { changePanelMode, requirePanel } from '../../../../../../lib/rolePanelOps';
import { isPanelMode } from '../../../../../../lib/selfRoles';

/** Changes a panel's mode, like /roles panel mode. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'roles', ['roles panel mode']);
		if (!resolved) return;
		const { guild, member } = resolved;

		const body = await readJsonBody<{ mode?: unknown }>(request);
		if (typeof body?.mode !== 'string' || !isPanelMode(body.mode))
			return response.error(HttpCodes.BadRequest, 'Pick normal, unique, verify or drop.');

		try {
			const panel = requirePanel(guild.id, Number(request.params.panel));
			const updated = await changePanelMode(guild, auditActor(member, 'dashboard'), panel, body.mode);
			return response.json(panelView(guild, updated));
		} catch (error) {
			return sendFailure(response, error);
		}
	}
}
