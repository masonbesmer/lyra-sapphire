import { HttpCodes, Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { readJsonBody } from '../../../../_helpers';
import { panelView, resolveModerator, sendFailure } from '../../../../_moderation';
import { auditActor } from '../../../../../../../lib/audit';
import { addPanelRole, requirePanel } from '../../../../../../../lib/rolePanelOps';
import { MAX_LABEL_LENGTH, getPanel } from '../../../../../../../lib/selfRoles';

/** Adds a role to a panel, or updates its emoji and label, like /roles panel add. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'roles', ['roles panel add']);
		if (!resolved) return;
		const { guild, member } = resolved;

		const body = await readJsonBody<{ role_id?: unknown; emoji?: unknown; label?: unknown }>(request);
		if (!body) return response.error(HttpCodes.BadRequest);
		const role = typeof body.role_id === 'string' && body.role_id !== guild.id ? guild.roles.cache.get(body.role_id) : undefined;
		if (!role) return response.error(HttpCodes.BadRequest, "That role isn't in this server.");
		if (body.emoji !== undefined && body.emoji !== null && typeof body.emoji !== 'string')
			return response.error(HttpCodes.BadRequest, 'emoji must be text.');
		if (body.label !== undefined && body.label !== null && typeof body.label !== 'string')
			return response.error(HttpCodes.BadRequest, 'label must be text.');
		const emoji = typeof body.emoji === 'string' && body.emoji.trim() ? body.emoji.trim() : null;
		const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, MAX_LABEL_LENGTH) : null;

		try {
			const panel = requirePanel(guild.id, Number(request.params.panel));
			await addPanelRole(guild, member, auditActor(member, 'dashboard'), panel, role, emoji, label);
			return response.json(panelView(guild, getPanel(guild.id, panel.id)!));
		} catch (error) {
			return sendFailure(response, error);
		}
	}
}
