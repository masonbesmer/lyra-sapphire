import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild } from '../_helpers';
import { getMessageLeaderboard, getVoiceLeaderboard } from '../../../../lib/leaderboard';

export class LeaderboardRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, { ...options, route: '/api/guilds/:guild/leaderboard' });
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const guild = resolveGuild(request, response, guildId);
		if (!guild) return;

		const query = request.query as Record<string, string>;
		const stat = query.stat;
		const period = (query.period ?? 'all') as 'all' | 'weekly' | 'monthly';

		if (stat !== 'messages' && stat !== 'voice') {
			response.error(HttpCodes.BadRequest);
			return;
		}

		if (period !== 'all' && period !== 'weekly' && period !== 'monthly') {
			response.error(HttpCodes.BadRequest);
			return;
		}

		const entries = stat === 'messages' ? getMessageLeaderboard(guildId, period) : getVoiceLeaderboard(guildId, period);

		const result = await Promise.all(
			entries.map(async (entry) => {
				let username: string;
				try {
					const member = await guild.members.fetch(entry.userId);
					username = member.displayName;
				} catch {
					username = entry.userId;
				}
				return { userId: entry.userId, username, value: entry.value };
			})
		);

		return response.json(result);
	}
}
