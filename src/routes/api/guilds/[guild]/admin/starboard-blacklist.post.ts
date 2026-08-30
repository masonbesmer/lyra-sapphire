import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, readJsonBody, requireAdmin } from '../../_helpers';
import { addToStarboardBlacklist, getStarboardBlacklist, removeFromStarboardBlacklist, type BlacklistTargetType } from '../../../../../lib/starboard';
import { auditActor, auditStarboardBlacklist } from '../../../../../lib/audit';

interface Body {
	action: 'add' | 'remove';
	target_id: string;
	target_type: BlacklistTargetType;
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
		if (body.target_type !== 'channel' && body.target_type !== 'user') return response.error(HttpCodes.BadRequest);
		if (typeof body.target_id !== 'string' || !/^\d{16,20}$/.test(body.target_id)) {
			return response.error(HttpCodes.BadRequest, 'That does not look like a Discord ID.');
		}

		if (body.action === 'add') {
			// Channels are verifiable from cache; users are not, since a blacklisted user
			// need not be a current member for the exclusion to stay meaningful.
			if (body.target_type === 'channel' && !guild.channels.cache.has(body.target_id)) {
				return response.error(HttpCodes.BadRequest, 'No channel in this server with that ID.');
			}
		}

		auditStarboardBlacklist(guild.id, auditActor(member, 'dashboard'), body.target_id, body.target_type, () => {
			if (body.action === 'add') addToStarboardBlacklist(guild.id, body.target_id, body.target_type);
			else removeFromStarboardBlacklist(guild.id, body.target_id, body.target_type);
		});

		return response.json(
			getStarboardBlacklist(guild.id).map((entry) => ({
				...entry,
				name:
					entry.target_type === 'channel'
						? (guild.channels.cache.get(entry.target_id)?.name ?? entry.target_id)
						: (guild.members.cache.get(entry.target_id)?.user.username ?? entry.target_id)
			}))
		);
	}
}
