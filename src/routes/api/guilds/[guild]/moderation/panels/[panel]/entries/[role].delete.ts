import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { panelView, resolveModerator, sendFailure } from '../../../../../_moderation';
import { auditActor } from '../../../../../../../../lib/audit';
import { removePanelRole, requirePanel } from '../../../../../../../../lib/rolePanelOps';
import { getPanel } from '../../../../../../../../lib/selfRoles';

/** Takes a role off a panel, like /roles panel remove. Members who have the role keep it. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'roles', ['roles panel remove']);
		if (!resolved) return;
		const { guild, member } = resolved;

		try {
			const panel = requirePanel(guild.id, Number(request.params.panel));
			await removePanelRole(guild, auditActor(member, 'dashboard'), panel, String(request.params.role));
			return response.json(panelView(guild, getPanel(guild.id, panel.id)!));
		} catch (error) {
			return sendFailure(response, error);
		}
	}
}
