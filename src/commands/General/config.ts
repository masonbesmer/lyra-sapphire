import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { GuildMember, Message } from 'discord.js';
import { getTranscribeConfig, setTranscribeConfig } from '../../lib/config';

@ApplyOptions<Command.Options>({
	name: 'config',
	description: 'Server configuration commands'
	// no preconditions - will check permissions at runtime
})
export class ConfigCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) => sub.setName('view').setDescription('View current configuration'))
				.addSubcommandGroup((group) =>
					group
						.setName('transcribe')
						.setDescription('Configure real-time transcription')
						.addSubcommand((sub) =>
							sub
								.setName('set')
								.setDescription('Set transcription options for this server')
								.addNumberOption((o) =>
									o.setName('min_audio_seconds').setDescription('Minimum seconds of audio before transcribing').setRequired(false)
								)
								.addIntegerOption((o) =>
									o.setName('interval_ms').setDescription('How often to check buffers and transcribe (ms)').setRequired(false)
								)
								.addIntegerOption((o) =>
									o.setName('chunk_s').setDescription('Chunk length in seconds to send to the ASR model').setRequired(false)
								)
						)
				)
		);
	}

	private async checkAdmin(member: GuildMember | null) {
		if (!member) return false;
		return member.permissions.has('ManageGuild') || member.permissions.has('Administrator');
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const member = interaction.member as GuildMember;
		const ok = await this.checkAdmin(member);
		if (!ok) return interaction.reply({ content: 'You must be a server admin to use this.', ephemeral: true });

		const group = interaction.options.getSubcommandGroup(false);
		const sub = interaction.options.getSubcommand(true);
		const guildId = interaction.guildId!;
		if (sub === 'view') {
			const cfg = getTranscribeConfig(guildId);
			return interaction.reply({
				content: `Transcribe settings:
min_audio_seconds=${cfg.min_audio_seconds}
interval_ms=${cfg.interval_ms}
chunk_s=${cfg.chunk_s}`
			});
		}

		if (group === 'transcribe' && sub === 'set') {
			const min = interaction.options.getNumber('min_audio_seconds', false);
			const interval = interaction.options.getInteger('interval_ms', false);
			const chunk = interaction.options.getInteger('chunk_s', false);
			const curr = getTranscribeConfig(guildId);
			// Validate inputs
			if (min !== null && (min < 0.1 || min > 20))
				return interaction.reply({ content: 'min_audio_seconds must be between 0.1 and 20 seconds', ephemeral: true });
			if (interval !== null && (interval < 200 || interval > 60000))
				return interaction.reply({ content: 'interval_ms must be between 200 and 60000 ms', ephemeral: true });
			if (chunk !== null && (chunk < 1 || chunk > 30))
				return interaction.reply({ content: 'chunk_s must be between 1 and 30 seconds', ephemeral: true });
			const newcfg = {
				guild_id: guildId,
				min_audio_seconds: min ?? curr.min_audio_seconds,
				interval_ms: interval ?? curr.interval_ms,
				chunk_s: chunk ?? curr.chunk_s
			};
			setTranscribeConfig(newcfg);
			this.container.logger.debug(`[CMD:CONFIG] (${guildId}) transcribe-set via slash by ${interaction.user.id}: ${JSON.stringify(newcfg)}`);
			return interaction.reply({
				content: `Updated transcribe settings for this server: min_audio_seconds=${newcfg.min_audio_seconds}, interval_ms=${newcfg.interval_ms}, chunk_s=${newcfg.chunk_s}`
			});
		}

		return interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
	}

	public override async messageRun(message: Message) {
		if (!message.guild || !message.member) return;
		const ok = await this.checkAdmin(message.member as GuildMember);
		if (!ok) return message.reply('You must be a server admin to use this.');

		const args = message.content.trim().split(/\s+/).slice(1);
		if (args.length === 0) return message.reply('Usage: %config view | %config transcribe-set <min_audio_seconds> <interval_ms> <chunk_s>');
		const sub = args[0];
		const guildId = message.guildId;
		if (sub === 'view') {
			const cfg = getTranscribeConfig(guildId);
			return message.reply(
				`Transcribe settings:\nmin_audio_seconds=${cfg.min_audio_seconds}\ninterval_ms=${cfg.interval_ms}\nchunk_s=${cfg.chunk_s}`
			);
		}
		// Support both: `transcribe set` and `transcribe-set`
		if (sub === 'transcribe-set' || (sub === 'transcribe' && args[1] === 'set')) {
			const baseIndex = sub === 'transcribe' ? 2 : 1;
			const min = parseFloat(args[baseIndex] ?? '');
			const interval = parseInt(args[baseIndex + 1] ?? '');
			const chunk = parseInt(args[baseIndex + 2] ?? '');
			const curr = getTranscribeConfig(guildId);
			// Validate inputs
			if (!isNaN(min) && (min < 0.1 || min > 20)) return message.reply('min_audio_seconds must be between 0.1 and 20 seconds');
			if (!isNaN(interval) && (interval < 200 || interval > 60000)) return message.reply('interval_ms must be between 200 and 60000 ms');
			if (!isNaN(chunk) && (chunk < 1 || chunk > 30)) return message.reply('chunk_s must be between 1 and 30 seconds');
			const newcfg = {
				guild_id: guildId,
				min_audio_seconds: isNaN(min) ? curr.min_audio_seconds : min,
				interval_ms: isNaN(interval) ? curr.interval_ms : interval,
				chunk_s: isNaN(chunk) ? curr.chunk_s : chunk
			};
			setTranscribeConfig(newcfg);
			this.container.logger.debug(`[CMD:CONFIG] (${guildId}) transcribe-set via chat by ${message.author.id}: ${JSON.stringify(newcfg)}`);
			return message.reply(
				`Updated transcribe settings for this server: min_audio_seconds=${newcfg.min_audio_seconds}, interval_ms=${newcfg.interval_ms}, chunk_s=${newcfg.chunk_s}`
			);
		}
		return message.reply('Unknown subcommand');
	}
}
