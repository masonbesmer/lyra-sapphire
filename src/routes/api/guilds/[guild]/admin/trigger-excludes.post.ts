import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, readJsonBody, requireAdmin } from '../../_helpers';
import { getExcludedTriggerChannels, setTriggerChannelExcluded } from '../../../../../lib/config';
import { auditActor, auditTriggerExclusion } from '../../../../../lib/audit';

interface Body {
	action: 'add' | 'remove';
	channel_id: string;
}

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;
		const { guild, member } = resolved;
		if (!requireAdmin(response, member)) return;

		const body = await readJsonBody<Body>(request);
		if (!body) return response.error(HttpCodes.BadRequest);
		if (body.action !== 'add' && body.action !== 'remove') return response.error(HttpCodes.BadRequest);
		if (typeof body.channel_id !== 'string' || !/^\d{16,20}$/.test(body.channel_id)) {
			return response.error(HttpCodes.BadRequest, 'That does not look like a Discord ID.');
		}
		// Checked on the way in only: a channel that is deleted later stays on the list, so
		// re-creating one with the same ID is impossible and the row is harmless either way.
		if (body.action === 'add' && !guild.channels.cache.has(body.channel_id)) {
			return response.error(HttpCodes.BadRequest, 'No channel in this server with that ID.');
		}

		auditTriggerExclusion(guild.id, auditActor(member, 'dashboard'), body.channel_id, () =>
			setTriggerChannelExcluded(guild.id, body.channel_id, body.action === 'add')
		);

		return response.json(getExcludedTriggerChannels(guild.id).map((id) => ({ channel_id: id, name: guild.channels.cache.get(id)?.name ?? id })));
	}
}
