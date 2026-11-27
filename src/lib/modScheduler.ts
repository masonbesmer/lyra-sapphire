import { container } from '@sapphire/framework';
import { DiscordAPIError, RESTJSONErrorCodes, type Client, type Guild } from 'discord.js';
import { completeScheduledAction, failScheduledAction, getDueActions, type ScheduledAction } from './moderation';
import { fetchMember, recordCase } from './modActions';
import { forgetStickyRole } from './selfRoles';

/**
 * Runs timed moderation actions (temp-ban expiry, timed-role removal) from the
 * `mod_scheduled_actions` table. The table is the source of truth, so a restart only delays
 * an overdue action until the first tick after boot instead of losing it.
 */

const TICK_MS = 30_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

/** Errors that mean the action has nothing left to do: retrying would never succeed. */
const GONE_CODES = new Set<number>([
	RESTJSONErrorCodes.UnknownBan,
	RESTJSONErrorCodes.UnknownMember,
	RESTJSONErrorCodes.UnknownUser,
	RESTJSONErrorCodes.UnknownRole
]);

export type ScheduledOutcome = 'done' | 'gone' | 'retry' | 'dropped';

async function apply(guild: Guild, action: ScheduledAction, botId: string): Promise<void> {
	const caseRef = action.case_number ? ` (case #${action.case_number})` : '';
	if (action.action === 'unban') {
		const reason = `Temp-ban expired${caseRef}`;
		const user = await guild.client.users.fetch(action.target_id).catch(() => null);
		await guild.bans.remove(action.target_id, reason);
		await recordCase(guild, {
			action: 'unban',
			targetId: action.target_id,
			targetTag: user?.username ?? null,
			moderatorId: botId,
			moderatorTag: guild.client.user?.username ?? null,
			reason
		});
		return;
	}

	// role-remove
	const member = await fetchMember(guild, action.target_id);
	if (!member) {
		// They left while the role was timed: make sure a sticky role doesn't come back with them.
		forgetStickyRole(guild.id, action.target_id, action.role_id);
		return;
	}
	if (!member.roles.cache.has(action.role_id)) return;
	const reason = `Timed role expired${caseRef}`;
	await member.roles.remove(action.role_id, reason);
	await recordCase(
		guild,
		{
			action: 'role-remove',
			targetId: member.id,
			targetTag: member.user.username,
			moderatorId: botId,
			moderatorTag: guild.client.user?.username ?? null,
			reason
		},
		[{ name: 'Role', value: `<@&${action.role_id}>` }]
	);
}

/** Runs one due action and settles its row. Exported for tests. */
export async function runScheduledAction(client: Client, action: ScheduledAction, now = new Date()): Promise<ScheduledOutcome> {
	const guild = client.guilds.cache.get(action.guild_id);
	// The bot left the guild: nothing it could do there any more.
	if (!guild) {
		completeScheduledAction(action.id);
		return 'gone';
	}
	try {
		await apply(guild, action, client.user?.id ?? '0');
		completeScheduledAction(action.id);
		return 'done';
	} catch (error) {
		if (error instanceof DiscordAPIError && GONE_CODES.has(error.code as number)) {
			completeScheduledAction(action.id);
			return 'gone';
		}
		const retrying = failScheduledAction(action.id, now);
		container.logger.warn(
			`[moderation] scheduled ${action.action} for ${action.target_id} in ${action.guild_id} failed${retrying ? ', will retry' : ', giving up'}: ${String(error)}`
		);
		return retrying ? 'retry' : 'dropped';
	}
}

export async function runDueActions(client: Client, now = new Date()): Promise<void> {
	if (running) return;
	running = true;
	try {
		for (const action of getDueActions(now)) await runScheduledAction(client, action, now);
	} finally {
		running = false;
	}
}

export function startModScheduler(client: Client): void {
	if (timer) return;
	const tick = () => void runDueActions(client).catch((error) => container.logger.error(`[moderation] scheduler tick failed: ${String(error)}`));
	tick();
	timer = setInterval(tick, TICK_MS);
	timer.unref();
}

export function stopModScheduler(): void {
	if (timer) clearInterval(timer);
	timer = null;
}
