import { HttpCodes, Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { PermissionFlagsBits } from 'discord.js';
import { resolveModerator } from '../../../_moderation';
import { fetchMember, snowflakeFrom } from '../../../../../../lib/modActions';
import { canUseScope } from '../../../../../../lib/modDashboard';
import { countCasesForTarget, getCasesForTarget, getNotes, getScheduledActions } from '../../../../../../lib/moderation';
import { countActiveWarns, getWarnExpiry } from '../../../../../../lib/warnThresholds';

/** Case-history cap for one member; /modlogs shows 50, the dashboard can afford more. */
const MAX_CASES = 500;

/** Full history for one user: who they are, whether they're here or banned, every case, notes and pending timed actions. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'members');
		if (!resolved) return;
		const { guild, member: moderator } = resolved;

		const id = snowflakeFrom(request.params.member);
		if (!id) return response.error(HttpCodes.BadRequest, "That isn't a user ID.");

		const target = await fetchMember(guild, id).catch(() => null);
		const user = target?.user ?? (await guild.client.users.fetch(id).catch(() => null));
		const total = countCasesForTarget(guild.id, id);
		if (!user && total === 0) return response.error(HttpCodes.NotFound, "Discord doesn't know that user, and there are no cases for them.");

		const me = guild.members.me;
		const ban = me?.permissions.has(PermissionFlagsBits.BanMembers) ? await guild.bans.fetch({ user: id, force: true }).catch(() => null) : null;
		const timeoutUntil =
			target?.communicationDisabledUntil && target.communicationDisabledUntil > new Date() ? target.communicationDisabledUntil : null;

		return response.json({
			id,
			tag: user?.username ?? getCasesForTarget(guild.id, id, 1)[0]?.target_tag ?? null,
			display_name: target?.displayName ?? user?.globalName ?? null,
			avatar_url: user?.displayAvatarURL({ size: 128 }) ?? null,
			bot: user?.bot ?? false,
			created_at: user?.createdAt.toISOString() ?? null,
			in_server: Boolean(target),
			joined_at: target?.joinedAt?.toISOString() ?? null,
			nickname: target?.nickname ?? null,
			timeout_until: timeoutUntil?.toISOString() ?? null,
			roles: target
				? target.roles.cache
						.filter((role) => role.id !== guild.id)
						.sort((a, b) => b.position - a.position)
						.map((role) => ({ id: role.id, name: role.name }))
				: [],
			// null = unknown (Lyra can't see bans), false = not banned.
			ban: ban ? { reason: ban.reason ?? null } : me?.permissions.has(PermissionFlagsBits.BanMembers) ? false : null,
			active_warns: countActiveWarns(guild.id, id),
			warn_expiry_ms: getWarnExpiry(guild.id),
			total_cases: total,
			cases: getCasesForTarget(guild.id, id, MAX_CASES),
			// Notes have their own gate (/note), so a mod who can read cases but not notes sees null, not an empty list.
			notes: canUseScope(moderator, 'notes') ? getNotes(guild.id, id, 200) : null,
			scheduled: getScheduledActions(guild.id, id)
		});
	}
}
