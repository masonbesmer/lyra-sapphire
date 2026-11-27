import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { PermissionFlagsBits, type Message } from 'discord.js';
import { auditActor, recordConfigChange } from '../../lib/audit';
import { ModError, respond } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, usage, type ModContext } from '../../lib/modCommand';
import { formatDuration, parseDuration } from '../../lib/moderation';
import {
	MAX_THRESHOLDS,
	THRESHOLD_ACTIONS,
	describeThreshold,
	getThresholds,
	getWarnExpiry,
	isThresholdAction,
	removeThreshold,
	setThreshold,
	setWarnExpiry,
	thresholdProblem
} from '../../lib/warnThresholds';

const USAGE =
	'`%warnconfig view` | `%warnconfig set <count> <timeout|kick|ban> [duration]` | `%warnconfig remove <count>` | `%warnconfig expiry <duration|off>`';

@ApplyOptions<ModCommandOptions>({
	name: 'warnconfig',
	description: 'Warn thresholds (e.g. 3 warns → timeout) and warn expiry',
	permission: PermissionFlagsBits.ManageGuild,
	clientPermission: 0n
})
export class WarnconfigCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addSubcommand((sub) => sub.setName('view').setDescription('Show the thresholds and warn expiry'))
				.addSubcommand((sub) =>
					sub
						.setName('set')
						.setDescription('Do something automatically when a member reaches N active warnings')
						.addIntegerOption((o) =>
							o.setName('count').setDescription('Number of active warnings').setRequired(true).setMinValue(1).setMaxValue(100)
						)
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('What happens')
								.setRequired(true)
								.addChoices(...THRESHOLD_ACTIONS.map((action) => ({ name: action, value: action })))
						)
						.addStringOption((o) =>
							o.setName('duration').setDescription('Timeout length (required), or temp-ban length (omit = permanent)')
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove a threshold')
						.addIntegerOption((o) =>
							o.setName('count').setDescription('Its warning count').setRequired(true).setMinValue(1).setMaxValue(100)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('expiry')
						.setDescription('How long a warning counts toward thresholds (omit to never expire)')
						.addStringOption((o) => o.setName('duration').setDescription('e.g. 30d, 12w'))
				)
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const options = interaction.options;
		return respond(interaction, () =>
			this.execute(
				contextOf(interaction),
				options.getSubcommand(true),
				options.getInteger('count'),
				options.getString('action'),
				options.getString('duration')
			)
		);
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const sub = (await args.pick('string').catch(() => '')).toLowerCase();
			const ctx = contextOf(message);
			if (sub === 'view') return this.execute(ctx, sub, null, null, null);
			if (sub === 'set') {
				const count = await args.pick('integer').catch(() => null);
				const action = (await args.pick('string').catch(() => '')).toLowerCase();
				const duration = await args.pick('string').catch(() => null);
				if (count === null || !action) usage(USAGE);
				return this.execute(ctx, sub, count, action, duration);
			}
			if (sub === 'remove') {
				const count = await args.pick('integer').catch(() => null);
				if (count === null) usage(USAGE);
				return this.execute(ctx, sub, count, null, null);
			}
			if (sub === 'expiry') {
				const duration = await args.pick('string').catch(() => null);
				if (!duration) usage(USAGE);
				return this.execute(ctx, sub, null, null, duration.toLowerCase() === 'off' ? null : duration);
			}
			return usage(USAGE);
		});
	}

	private async execute({ guild, moderator }: ModContext, sub: string, count: number | null, action: string | null, duration: string | null) {
		const actor = auditActor(moderator, 'discord');
		const thresholds = getThresholds(guild.id);
		const describeAll = (list = getThresholds(guild.id)) => list.map(describeThreshold).join(', ') || 'none';

		if (sub === 'view') {
			const expiry = getWarnExpiry(guild.id);
			return [
				'**Warn thresholds:**',
				thresholds.length ? thresholds.map((entry) => `• ${describeThreshold(entry)}`).join('\n') : '• none',
				`**Warn expiry:** ${expiry ? `${formatDuration(expiry)} (older warnings stop counting)` : 'never'}`,
				'-# A threshold fires when a member reaches exactly that many active warnings, from /warn or AutoMod.'
			].join('\n');
		}

		let durationMs: number | null = null;
		if (duration) {
			durationMs = parseDuration(duration);
			if (!durationMs) throw new ModError(`"${duration}" isn't a duration I understand. try \`1h\`, \`7d\` or \`30d\`.`);
		}

		if (sub === 'expiry') {
			const before = getWarnExpiry(guild.id);
			setWarnExpiry(guild.id, durationMs);
			recordConfigChange(guild.id, actor, 'moderation', 'warn_expiry_ms', before, durationMs);
			return durationMs ? `⏳ warnings stop counting after **${formatDuration(durationMs)}**.` : '⏳ warnings never expire.';
		}

		if (count === null) return usage(USAGE);
		const before = describeAll(thresholds);

		if (sub === 'remove') {
			if (!removeThreshold(guild.id, count)) throw new ModError(`there's no threshold at ${count} warnings.`);
			recordConfigChange(guild.id, actor, 'moderation', 'warn_thresholds', before, describeAll());
			return `🗑️ removed the ${count}-warning threshold.`;
		}

		if (!action || !isThresholdAction(action)) throw new ModError(`pick one of: ${THRESHOLD_ACTIONS.join(', ')}.`);
		const problem = thresholdProblem(count, action, durationMs);
		if (problem) throw new ModError(problem);
		if (!thresholds.some((entry) => entry.warn_count === count) && thresholds.length >= MAX_THRESHOLDS) {
			throw new ModError(`a server can have at most ${MAX_THRESHOLDS} thresholds.`);
		}
		setThreshold(guild.id, count, action, durationMs);
		recordConfigChange(guild.id, actor, 'moderation', 'warn_thresholds', before, describeAll());
		const saved = getThresholds(guild.id).find((entry) => entry.warn_count === count)!;
		return `⚖️ ${describeThreshold(saved)}.`;
	}
}
