import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import type { Guild, GuildAuditLogsEntry, User } from 'discord.js';
import { manualCaseFromAudit } from '../../lib/eventLog';
import { recordCase } from '../../lib/modActions';

/**
 * A ban, unban, kick or timeout done by hand in Discord (or by another bot) gets a case too, so
 * /modlogs shows the full history. Lyra's own actions are skipped: her commands opened the case
 * already. Discord only sends these to bots with View Audit Log, over the GuildModeration intent.
 */
@ApplyOptions<Listener.Options>({ name: 'eventLogAuditLogCases', event: Events.GuildAuditLogEntryCreate })
export class EventLogAuditLogCases extends Listener<typeof Events.GuildAuditLogEntryCreate> {
	public async run(entry: GuildAuditLogsEntry, guild: Guild) {
		const botId = this.container.client.user?.id;
		if (!botId) return;
		const manual = manualCaseFromAudit(entry, botId);
		if (!manual || !entry.targetId || !entry.executorId) return;

		const target = (entry.target as User | null) ?? (await this.container.client.users.fetch(entry.targetId).catch(() => null));
		const executor = entry.executor ?? (await this.container.client.users.fetch(entry.executorId).catch(() => null));
		try {
			await recordCase(guild, {
				action: manual.action,
				targetId: entry.targetId,
				targetTag: target && 'username' in target ? target.username : null,
				moderatorId: entry.executorId,
				moderatorTag: executor?.username ?? null,
				reason: entry.reason,
				durationMs: manual.durationMs,
				expiresAt: manual.expiresAt
			});
		} catch (error) {
			this.container.logger.error(`[moderation] couldn't record a ${manual.action} from the audit log in ${guild.id}: ${String(error)}`);
		}
	}
}
