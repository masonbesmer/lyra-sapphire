import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { GuildMember, Message, Role } from 'discord.js';
import { getTranscribeConfig, setTranscribeConfig, getMusicConfig, setMusicConfig } from '../../lib/config';

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
				.addSubcommandGroup((group) =>
					group
						.setName('music')
						.setDescription('Configure music system')
						.addSubcommand((sub) =>
							sub
								.setName('dj-role')
								.setDescription('Set or clear the DJ role required for destructive music actions')
								.addRoleOption((o) => o.setName('role').setDescription('The DJ role (omit to clear)').setRequired(false))
						)
						.addSubcommand((sub) =>
							sub
								.setName('default-volume')
								.setDescription('Set the default volume for new queues')
								.addIntegerOption((o) =>
									o.setName('level').setDescription('Volume level (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('announce')
								.setDescription('Toggle track announcement messages')
								.addStringOption((o) =>
									o
										.setName('state')
										.setDescription('on or off')
										.setRequired(true)
										.addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
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
			const mcfg = getMusicConfig(guildId);
			return interaction.reply({
				content: `**Transcribe settings:**
min_audio_seconds=${cfg.min_audio_seconds}
interval_ms=${cfg.interval_ms}
chunk_s=${cfg.chunk_s}

**Music settings:**
dj_role=${mcfg.dj_role_id ? `<@&${mcfg.dj_role_id}>` : 'None'}
default_volume=${mcfg.default_volume}
announce_tracks=${mcfg.announce_tracks ? 'on' : 'off'}`
			});
		}

		if (group === 'transcribe' && sub === 'set') {
			const min = interaction.options.getNumber('min_audio_seconds', false);
			const interval = interaction.options.getInteger('interval_ms', false);
			const chunk = interaction.options.getInteger('chunk_s', false);
			const curr = getTranscribeConfig(guildId);
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
				content: `Updated transcribe settings: min_audio_seconds=${newcfg.min_audio_seconds}, interval_ms=${newcfg.interval_ms}, chunk_s=${newcfg.chunk_s}`
			});
		}

		if (group === 'music') {
			if (sub === 'dj-role') {
				const role = interaction.options.getRole('role', false) as Role | null;
				setMusicConfig({ guild_id: guildId, dj_role_id: role ? role.id : null });
				return interaction.reply({
					content: role ? `🎵 DJ role set to <@&${role.id}>` : '🎵 DJ role restriction removed.'
				});
			}
			if (sub === 'default-volume') {
				const level = interaction.options.getInteger('level', true);
				setMusicConfig({ guild_id: guildId, default_volume: level });
				return interaction.reply({ content: `🔊 Default volume set to **${level}%**` });
			}
			if (sub === 'announce') {
				const state = interaction.options.getString('state', true) === 'on';
				setMusicConfig({ guild_id: guildId, announce_tracks: state });
				return interaction.reply({ content: `📢 Track announcements: **${state ? 'on' : 'off'}**` });
			}
		}

		return interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
	}

	public override async messageRun(message: Message) {
		if (!message.guild || !message.member) return;
		const ok = await this.checkAdmin(message.member as GuildMember);
		if (!ok) return message.reply('You must be a server admin to use this.');

		const args = message.content.trim().split(/\s+/).slice(1);
		if (args.length === 0) return message.reply('Usage: %config view | %config transcribe set <min> <interval> <chunk> | %config music dj-role [@role|clear] | %config music default-volume <1-100> | %config music announce <on|off>');
		const sub = args[0];
		const guildId = message.guildId;

		if (sub === 'view') {
			const cfg = getTranscribeConfig(guildId);
			const mcfg = getMusicConfig(guildId);
			return message.reply(
				`**Transcribe settings:**\nmin_audio_seconds=${cfg.min_audio_seconds}\ninterval_ms=${cfg.interval_ms}\nchunk_s=${cfg.chunk_s}\n\n**Music settings:**\ndj_role=${mcfg.dj_role_id ? `<@&${mcfg.dj_role_id}>` : 'None'}\ndefault_volume=${mcfg.default_volume}\nannounce_tracks=${mcfg.announce_tracks ? 'on' : 'off'}`
			);
		}

		if (sub === 'transcribe-set' || (sub === 'transcribe' && args[1] === 'set')) {
			const baseIndex = sub === 'transcribe' ? 2 : 1;
			const min = parseFloat(args[baseIndex] ?? '');
			const interval = parseInt(args[baseIndex + 1] ?? '');
			const chunk = parseInt(args[baseIndex + 2] ?? '');
			const curr = getTranscribeConfig(guildId);
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
				`Updated transcribe settings: min_audio_seconds=${newcfg.min_audio_seconds}, interval_ms=${newcfg.interval_ms}, chunk_s=${newcfg.chunk_s}`
			);
		}

		if (sub === 'music') {
			const msub = args[1];
			if (msub === 'dj-role') {
				const roleArg = args[2];
				if (!roleArg || roleArg === 'clear') {
					setMusicConfig({ guild_id: guildId, dj_role_id: null });
					return message.reply('🎵 DJ role restriction removed.');
				}
				// Extract role ID from mention or bare ID
				const roleId = roleArg.replace(/[<@&>]/g, '');
				const role = message.guild?.roles.cache.get(roleId);
				if (!role) return message.reply('Role not found. Please mention a role or use its ID.');
				setMusicConfig({ guild_id: guildId, dj_role_id: role.id });
				return message.reply(`🎵 DJ role set to <@&${role.id}>`);
			}
			if (msub === 'default-volume') {
				const level = parseInt(args[2] ?? '');
				if (isNaN(level) || level < 1 || level > 100) return message.reply('Please provide a volume between 1 and 100.');
				setMusicConfig({ guild_id: guildId, default_volume: level });
				return message.reply(`🔊 Default volume set to **${level}%**`);
			}
			if (msub === 'announce') {
				const state = args[2]?.toLowerCase();
				if (state !== 'on' && state !== 'off') return message.reply('Please specify `on` or `off`.');
				setMusicConfig({ guild_id: guildId, announce_tracks: state === 'on' });
				return message.reply(`📢 Track announcements: **${state}**`);
			}
			return message.reply('Unknown music subcommand. Use: dj-role, default-volume, announce');
		}

		return message.reply('Unknown subcommand');
	}
}
