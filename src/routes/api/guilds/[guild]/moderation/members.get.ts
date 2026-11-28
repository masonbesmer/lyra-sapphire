import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { resolveModerator } from '../../_moderation';
import { snowflakeFrom } from '../../../../../lib/modActions';
import { countCasesForTarget, findCaseTargets } from '../../../../../lib/moderation';

interface Hit {
	id: string;
	tag: string | null;
	display_name: string | null;
	avatar_url: string | null;
	in_server: boolean;
	cases: number;
}

/**
 * Member lookup search: `?q=` is a user ID/mention, or part of a name. Matches members still in
 * the server and anyone with a case on record, so people who left (or were banned) still turn up.
 */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'members');
		if (!resolved) return;
		const { guild } = resolved;

		const q = String((request.query as Record<string, string | undefined>)?.q ?? '')
			.trim()
			.slice(0, 100);
		if (!q) return response.json([]);

		const hits = new Map<string, Hit>();
		const id = snowflakeFrom(q);
		if (id) {
			const member = await guild.members.fetch(id).catch(() => null);
			const user = member?.user ?? (await guild.client.users.fetch(id).catch(() => null));
			const cases = countCasesForTarget(guild.id, id);
			if (user || cases) {
				hits.set(id, {
					id,
					tag: user?.username ?? null,
					display_name: member?.displayName ?? user?.globalName ?? null,
					avatar_url: user?.displayAvatarURL({ size: 64 }) ?? null,
					in_server: Boolean(member),
					cases
				});
			}
			return response.json([...hits.values()]);
		}

		const members = await guild.members.search({ query: q, limit: 10 }).catch(() => null);
		for (const member of members?.values() ?? []) {
			hits.set(member.id, {
				id: member.id,
				tag: member.user.username,
				display_name: member.displayName,
				avatar_url: member.user.displayAvatarURL({ size: 64 }),
				in_server: true,
				cases: countCasesForTarget(guild.id, member.id)
			});
		}
		for (const target of findCaseTargets(guild.id, q)) {
			if (hits.has(target.target_id)) continue;
			hits.set(target.target_id, {
				id: target.target_id,
				tag: target.target_tag,
				display_name: null,
				avatar_url: null,
				in_server: guild.members.cache.has(target.target_id),
				cases: target.cases
			});
		}
		return response.json([...hits.values()]);
	}
}
