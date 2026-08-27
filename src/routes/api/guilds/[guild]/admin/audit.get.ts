import { Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import type { Guild } from 'discord.js';
import { resolveGuild, requireAdmin } from '../../_helpers';
import { getAuditSections, getConfigAudit, type AuditSection, type ConfigAuditRow } from '../../../../../lib/audit';

const SECTIONS: AuditSection[] = ['music', 'starboard', 'starboard_blacklist', 'voice', 'permissions', 'triggers'];

const SNOWFLAKE = /^\d{16,20}$/;

/**
 * Stored values are raw - a role ID means nothing to someone reading the log. Resolve one to
 * a name where the cache still knows it, and leave the ID alone where it doesn't, rather than
 * pretending the lookup succeeded.
 */
function label(guild: Guild, value: string | null): string | null {
	if (value === null || !SNOWFLAKE.test(value)) return value;
	const role = guild.roles.cache.get(value);
	if (role) return `@${role.name}`;
	const channel = guild.channels.cache.get(value);
	if (channel) return `#${channel.name}`;
	const member = guild.members.cache.get(value);
	if (member) return member.user.username;
	return value;
}

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;
		const { guild, member } = resolved;
		// Same gate as the rest of the config surface: the log names who changed what,
		// which is not something a non-admin member gets to read.
		if (!requireAdmin(response, member)) return;

		const query = (request.query ?? {}) as Record<string, string | undefined>;
		const page = Math.max(parseInt(query.page ?? '1') || 1, 1);
		const limit = Math.min(Math.max(parseInt(query.limit ?? '25') || 25, 1), 100);
		const section = SECTIONS.includes(query.section as AuditSection) ? (query.section as AuditSection) : undefined;

		const rows = getConfigAudit(guild.id, { limit, offset: (page - 1) * limit, section });

		return response.json({
			page,
			limit,
			sections: getAuditSections(guild.id),
			rows: rows.map((row: ConfigAuditRow) => ({
				...row,
				old_label: label(guild, row.old_value),
				new_label: label(guild, row.new_value)
			}))
		});
	}
}
