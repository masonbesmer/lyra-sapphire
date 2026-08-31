import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { Command } from '@sapphire/framework';
import { EmbedBuilder, MessageFlags, PermissionFlagsBits, type GuildMember } from 'discord.js';
import {
	deleteVoiceWordTrigger,
	getVoiceAssistantConfig,
	getVoiceTriggersUsingSound,
	getVoiceWordTriggers,
	setVoiceWordTrigger,
	type VoiceWordTrigger
} from '../../lib/config';
import { auditActor, recordConfigChange } from '../../lib/audit';
import { deleteSound, listSounds, MAX_SOUND_BYTES, saveSound, soundPath } from '../../lib/voice/sounds';
import { isAssistantActive } from '../../lib/voice/session';
import { DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS, MIN_COOLDOWN_MS } from '../../lib/voice/triggers';
import { MAX_SPOKEN_CHARS } from '../../lib/voice/ttsClient';

/**
 * Manages the spoken-keyword triggers.
 *
 * Separate from `/keyword`, which manages the chat ones. They are separate lists for a reason
 * (see `voice_word_triggers` in database.ts) and one command over both would blur that.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'voicekeyword',
	description: 'Manage spoken word triggers for the voice listener',
	requiredUserPermissions: [PermissionFlagsBits.ManageGuild],
	subcommands: [
		{ name: 'add', chatInputRun: 'chatInputAdd' },
		{ name: 'add-speak', chatInputRun: 'chatInputAddSpeak' },
		{ name: 'add-sound', chatInputRun: 'chatInputAddSound' },
		{ name: 'delete', chatInputRun: 'chatInputDelete' },
		{ name: 'list', chatInputRun: 'chatInputList' },
		{ name: 'sounds', chatInputRun: 'chatInputSounds' },
		{ name: 'delete-sound', chatInputRun: 'chatInputDeleteSound' }
	]
})
export class VoiceKeywordCommand extends Subcommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Reply in chat when someone says a word out loud')
						.addStringOption((opt) => opt.setName('keyword').setDescription('The spoken word or phrase').setRequired(true))
						.addStringOption((opt) => opt.setName('response').setDescription('What to reply with').setRequired(true))
						.addIntegerOption((opt) =>
							opt
								.setName('cooldown')
								.setDescription('Seconds before this trigger can fire again (default 30)')
								.setMinValue(MIN_COOLDOWN_MS / 1000)
								.setMaxValue(MAX_COOLDOWN_MS / 1000)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('add-speak')
						.setDescription('Say something out loud in the voice channel when someone says a word')
						.addStringOption((opt) => opt.setName('keyword').setDescription('The spoken word or phrase').setRequired(true))
						.addStringOption((opt) =>
							opt.setName('response').setDescription('What to say out loud').setRequired(true).setMaxLength(MAX_SPOKEN_CHARS)
						)
						.addIntegerOption((opt) =>
							opt
								.setName('cooldown')
								.setDescription('Seconds before this trigger can fire again (default 30)')
								.setMinValue(MIN_COOLDOWN_MS / 1000)
								.setMaxValue(MAX_COOLDOWN_MS / 1000)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('add-sound')
						.setDescription('Play a sound clip when someone says a word out loud')
						.addStringOption((opt) => opt.setName('keyword').setDescription('The spoken word or phrase').setRequired(true))
						.addAttachmentOption((opt) => opt.setName('clip').setDescription('The audio clip to play (max 2 MB)').setRequired(true))
						.addStringOption((opt) => opt.setName('name').setDescription('Name to store the clip under (defaults to the keyword)'))
						.addIntegerOption((opt) =>
							opt
								.setName('cooldown')
								.setDescription('Seconds before this trigger can fire again (default 30)')
								.setMinValue(MIN_COOLDOWN_MS / 1000)
								.setMaxValue(MAX_COOLDOWN_MS / 1000)
						)
				)
				.addSubcommand((sub) =>
					sub
						.setName('delete')
						.setDescription('Delete a spoken word trigger')
						.addStringOption((opt) => opt.setName('keyword').setDescription('The spoken word or phrase').setRequired(true))
				)
				.addSubcommand((sub) => sub.setName('list').setDescription('List the spoken word triggers'))
				.addSubcommand((sub) => sub.setName('sounds').setDescription('List the stored sound clips'))
				.addSubcommand((sub) =>
					sub
						.setName('delete-sound')
						.setDescription('Delete a stored sound clip')
						.addStringOption((opt) => opt.setName('name').setDescription('The clip name').setRequired(true))
				)
		);
	}

	/** The trigger's response is the audited value, so the log shows what it used to do. */
	private audit(guildId: string, member: GuildMember, keyword: string, next: VoiceWordTrigger | null) {
		const describe = (trigger: VoiceWordTrigger | null | undefined) => (trigger ? `${trigger.response_type}: ${trigger.response}` : null);
		const previous = describe(getVoiceWordTriggers(guildId).find((trigger) => trigger.keyword === keyword));
		return () => recordConfigChange(guildId, auditActor(member, 'discord'), 'voice_triggers', keyword, previous, describe(next));
	}

	private cooldownMs(interaction: Command.ChatInputCommandInteraction): number {
		const seconds = interaction.options.getInteger('cooldown');
		return seconds === null ? DEFAULT_COOLDOWN_MS : seconds * 1000;
	}

	public async chatInputAdd(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });

		const keyword = interaction.options.getString('keyword', true).trim().toLowerCase();
		const response = interaction.options.getString('response', true).trim();
		if (!keyword || !response) return interaction.reply({ content: 'both a keyword and a response, please.', flags: MessageFlags.Ephemeral });

		const trigger: VoiceWordTrigger = { keyword, response_type: 'text', response, cooldown_ms: this.cooldownMs(interaction) };
		const commit = this.audit(interaction.guildId, interaction.member as GuildMember, keyword, trigger);
		setVoiceWordTrigger(interaction.guildId, trigger);
		commit();

		return interaction.reply({
			content: `✅ when someone says **${keyword}** out loud, I'll reply in chat. ${this.armedHint(interaction.guildId)}`,
			flags: MessageFlags.Ephemeral
		});
	}

	public async chatInputAddSpeak(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });

		const keyword = interaction.options.getString('keyword', true).trim().toLowerCase();
		const response = interaction.options.getString('response', true).trim();
		if (!keyword || !response)
			return interaction.reply({ content: 'both a keyword and something to say, please.', flags: MessageFlags.Ephemeral });
		// setMaxLength already refuses a longer one client-side; this covers the rest.
		if (response.length > MAX_SPOKEN_CHARS) {
			return interaction.reply({ content: `keep it to ${MAX_SPOKEN_CHARS} characters or fewer.`, flags: MessageFlags.Ephemeral });
		}

		const trigger: VoiceWordTrigger = { keyword, response_type: 'speak', response, cooldown_ms: this.cooldownMs(interaction) };
		const commit = this.audit(interaction.guildId, interaction.member as GuildMember, keyword, trigger);
		setVoiceWordTrigger(interaction.guildId, trigger);
		commit();

		return interaction.reply({
			content: `✅ when someone says **${keyword}** out loud, I'll say it back in the voice channel. ${this.armedHint(interaction.guildId)}`,
			flags: MessageFlags.Ephemeral
		});
	}

	public async chatInputAddSound(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });

		const keyword = interaction.options.getString('keyword', true).trim().toLowerCase();
		const clip = interaction.options.getAttachment('clip', true);
		const name = interaction.options.getString('name')?.trim() || keyword;
		if (!keyword) return interaction.reply({ content: 'give me a keyword.', flags: MessageFlags.Ephemeral });

		// Downloading can take a moment, and the three-second interaction window is not enough
		// to promise on.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const saved = await saveSound(interaction.guildId, name, clip.url, clip.size);
		if (!saved.ok) return interaction.editReply(`❌ ${saved.error}`);

		const trigger: VoiceWordTrigger = {
			keyword,
			response_type: 'sound',
			response: saved.name,
			cooldown_ms: this.cooldownMs(interaction)
		};
		const commit = this.audit(interaction.guildId, interaction.member as GuildMember, keyword, trigger);
		setVoiceWordTrigger(interaction.guildId, trigger);
		commit();

		return interaction.editReply(
			`✅ when someone says **${keyword}** out loud, I'll play **${saved.name}** in the voice channel. ${this.armedHint(interaction.guildId)}`
		);
	}

	public async chatInputDelete(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });

		const keyword = interaction.options.getString('keyword', true).trim().toLowerCase();
		const commit = this.audit(interaction.guildId, interaction.member as GuildMember, keyword, null);
		if (!deleteVoiceWordTrigger(interaction.guildId, keyword)) {
			return interaction.reply({ content: `no spoken trigger for \`${keyword}\`.`, flags: MessageFlags.Ephemeral });
		}
		commit();
		return interaction.reply({ content: `✅ deleted the spoken trigger for \`${keyword}\`.`, flags: MessageFlags.Ephemeral });
	}

	public async chatInputList(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });

		const rows = getVoiceWordTriggers(interaction.guildId);
		const embed = new EmbedBuilder().setColor('#6B73FF').setTitle('🎙️ Spoken word triggers');

		if (rows.length === 0) {
			return interaction.reply({
				embeds: [
					embed
						.setDescription('nothing set up yet.\n\nuse `/voicekeyword add` or `/voicekeyword add-sound` to create one.')
						.setFooter({ text: 'Spoken triggers only fire while the voice listener is running.' })
				],
				flags: MessageFlags.Ephemeral
			});
		}

		const description = rows
			.map((row) => {
				const trimmed = row.response.length > 80 ? `${row.response.slice(0, 77)}...` : row.response;
				const what =
					row.response_type === 'sound'
						? `🔊 plays \`${row.response}\`${soundPath(interaction.guildId!, row.response) ? '' : ' ⚠️ **missing**'}`
						: row.response_type === 'speak'
							? `🗣️ says ${trimmed}`
							: `💬 ${trimmed}`;
				return `**\`${row.keyword}\`** — ${what}\n    ↳ every ${Math.round(row.cooldown_ms / 1000)}s at most`;
			})
			.join('\n\n');

		return interaction.reply({
			embeds: [
				embed
					.setDescription(description)
					.setFooter({ text: `${rows.length} trigger${rows.length === 1 ? '' : 's'} • ${this.armedHint(interaction.guildId)}` })
			],
			flags: MessageFlags.Ephemeral
		});
	}

	public async chatInputSounds(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });

		const names = listSounds(interaction.guildId);
		return interaction.reply({
			content: names.length
				? `🔊 stored clips: ${names.map((name) => `\`${name}\``).join(', ')}`
				: `no clips stored yet. \`/voicekeyword add-sound\` uploads one (max ${MAX_SOUND_BYTES / 1024 / 1024} MB).`,
			flags: MessageFlags.Ephemeral
		});
	}

	public async chatInputDeleteSound(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply({ content: 'use this in a server.', flags: MessageFlags.Ephemeral });

		const name = interaction.options.getString('name', true).trim();
		// Named rather than blocked: the triggers stay, so re-uploading a clip under the same
		// name repairs them without anyone having to rebuild the list.
		const orphaned = getVoiceTriggersUsingSound(interaction.guildId, name);
		if (!deleteSound(interaction.guildId, name)) {
			return interaction.reply({ content: `no clip called \`${name}\`.`, flags: MessageFlags.Ephemeral });
		}

		const warning = orphaned.length
			? `\n⚠️ ${orphaned.map((trigger) => `\`${trigger.keyword}\``).join(', ')} still point${orphaned.length === 1 ? 's' : ''} at it and won't play until you re-upload a clip under that name.`
			: '';
		return interaction.reply({ content: `✅ deleted the clip \`${name}\`.${warning}`, flags: MessageFlags.Ephemeral });
	}

	/** Triggers are inert until both the config flag and a running session exist; say which is missing. */
	private armedHint(guildId: string): string {
		if (!getVoiceAssistantConfig(guildId).triggers_enabled) return 'Spoken triggers are off — turn them on in the dashboard.';
		if (!isAssistantActive(guildId)) return "I'm not listening yet — run `/assistant on` in a voice channel.";
		return "I'm listening now.";
	}
}
