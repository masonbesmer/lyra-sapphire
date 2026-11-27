import { HttpCodes, Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { readJsonBody } from '../../_helpers';
import { panelView, resolveModerator, sendFailure } from '../../_moderation';
import { auditActor } from '../../../../../lib/audit';
import { createRolePanel } from '../../../../../lib/rolePanelOps';
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, isPanelKind, isPanelMode, parseMessageLink } from '../../../../../lib/selfRoles';

interface Body {
	kind?: unknown;
	mode?: unknown;
	channel_id?: unknown;
	/** A message link turns that existing message into a reaction panel instead of posting one. */
	message_link?: unknown;
	title?: unknown;
	description?: unknown;
}

function optionalText(value: unknown, max: number): string | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') return undefined;
	return value.trim() ? value.trim().slice(0, max) : null;
}

/** Posts a new role panel, like /roles panel create. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'roles', ['roles panel create']);
		if (!resolved) return;
		const { guild, member } = resolved;

		const body = await readJsonBody<Body>(request);
		if (!body) return response.error(HttpCodes.BadRequest);
		if (typeof body.kind !== 'string' || !isPanelKind(body.kind))
			return response.error(HttpCodes.BadRequest, 'Pick buttons, a select menu or reactions.');
		const mode = body.mode ?? 'normal';
		if (typeof mode !== 'string' || !isPanelMode(mode)) return response.error(HttpCodes.BadRequest, 'Pick normal, unique, verify or drop.');
		const title = optionalText(body.title, MAX_TITLE_LENGTH);
		const description = optionalText(body.description, MAX_DESCRIPTION_LENGTH);
		if (title === undefined || description === undefined) return response.error(HttpCodes.BadRequest, 'Title and description must be text.');

		let channelId = typeof body.channel_id === 'string' ? body.channel_id : null;
		let messageId: string | null = null;
		if (body.message_link !== undefined && body.message_link !== null && body.message_link !== '') {
			const link = typeof body.message_link === 'string' ? parseMessageLink(body.message_link.trim()) : null;
			if (!link) return response.error(HttpCodes.BadRequest, "That isn't a Discord message link.");
			({ channelId, messageId } = link);
		}

		try {
			const { panel } = await createRolePanel(guild, member, auditActor(member, 'dashboard'), {
				kind: body.kind,
				mode,
				channelId,
				messageId,
				title,
				description
			});
			return response.json(panelView(guild, panel));
		} catch (error) {
			return sendFailure(response, error);
		}
	}
}
