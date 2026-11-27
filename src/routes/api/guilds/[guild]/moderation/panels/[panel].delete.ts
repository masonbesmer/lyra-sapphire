import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveModerator, sendFailure } from '../../../_moderation';
import { auditActor } from '../../../../../../lib/audit';
import { deleteRolePanel, requirePanel } from '../../../../../../lib/rolePanelOps';

/** Deletes a panel (and its message, if Lyra posted it), like /roles panel delete. Members keep their roles. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'roles', ['roles panel delete']);
		if (!resolved) return;
		const { guild, member } = resolved;

		try {
			const panel = requirePanel(guild.id, Number(request.params.panel));
			await deleteRolePanel(guild, auditActor(member, 'dashboard'), panel);
			return response.json({ ok: true, id: panel.id });
		} catch (error) {
			return sendFailure(response, error);
		}
	}
}
