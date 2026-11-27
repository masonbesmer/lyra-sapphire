import { HttpCodes, Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { readJsonBody } from '../../_helpers';
import { idChecks, resolveModerator } from '../../_moderation';
import { getAntiRaidConfig, isRaidActive, updateAntiRaidConfig, validateSettings } from '../../../../../lib/antiRaid';
import { auditActor, recordConfigDiff } from '../../../../../lib/audit';
import { antiRaidAuditSnapshot, parseAntiRaidPatch } from '../../../../../lib/modDashboard';

/**
 * Anti-raid and verification-gate settings, with the same checks as /antiraid set. Posting the
 * verification button and ending a raid stay in Discord (/antiraid verification, /antiraid end).
 */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveModerator(request, response, 'antiraid');
		if (!resolved) return;
		const { guild, member } = resolved;

		const body = await readJsonBody<Record<string, unknown>>(request);
		if (!body || typeof body !== 'object') return response.error(HttpCodes.BadRequest);

		const parsed = parseAntiRaidPatch(body, idChecks(guild));
		if ('error' in parsed) return response.error(HttpCodes.BadRequest, parsed.error);
		if (!Object.keys(parsed.settings).length) return response.error(HttpCodes.BadRequest, 'Nothing to change.');

		// Lyra has to be able to hand out (and take back) the roles she gates joins with.
		const me = guild.members.me ?? (await guild.members.fetchMe());
		for (const key of ['quarantine_role_id', 'verify_role_id'] as const) {
			const id = parsed.settings[key];
			if (!id) continue;
			const role = guild.roles.cache.get(id)!;
			if (role.managed) return response.error(HttpCodes.BadRequest, `I can't hand out @${role.name}: an integration manages it.`);
			if (role.position >= me.roles.highest.position) {
				return response.error(HttpCodes.BadRequest, `@${role.name} is equal to or above my top role, so Discord won't let me give it out.`);
			}
		}

		const before = getAntiRaidConfig(guild.id);
		const problem = validateSettings({ ...before, ...parsed.settings });
		if (problem) return response.error(HttpCodes.BadRequest, problem.charAt(0).toUpperCase() + problem.slice(1));
		const after = updateAntiRaidConfig(guild.id, parsed.settings);
		recordConfigDiff(guild.id, auditActor(member, 'dashboard'), 'moderation', antiRaidAuditSnapshot(before), antiRaidAuditSnapshot(after));
		return response.json({ config: after, raid_active: isRaidActive(after) });
	}
}
