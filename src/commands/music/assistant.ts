import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, GuildMember } from 'discord.js';
import {
	getVoiceAssistantConfig,
	isVoiceFollowEnabled,
	isVoiceOptedOut,
	setVoiceAssistantConfig,
	setVoiceFollow,
	setVoiceOptOut
} from '../../lib/config';
import { auditActor, auditConfigMutation } from '../../lib/audit';
import { checkDJPermission } from '../../lib/music';
import { isAssistantActive, startAssistantSession, stopAssistantSession } from '../../lib/voice/session';
import { isHealthy as isTtsHealthy } from '../../lib/voice/ttsClient';

// No InVoiceWithBot precondition. It gates on the *music* bot's channel, which has nothing to
// do with the assistant, and both the opt-out and the follow toggle are settings you have to be
// able to change from a text channel — `/assistant follow on` before you join is the whole
// point of it. `on` checks for a voice channel itself.
@ApplyOptions<Command.Options>({
	name: 'assistant',
	description: 'Control the wake-word voice assistant'
})
export class AssistantCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((sub) => sub.setName('on').setDescription('Start listening for the wake word in your voice channel'))
				.addSubcommand((sub) => sub.setName('off').setDescription('Stop listening'))
				.addSubcommand((sub) => sub.setName('status').setDescription('Show whether the assistant is listening, and your opt-out state'))
				.addSubcommand((sub) => sub.setName('optout').setDescription('Never process your voice, even while the assistant is listening'))
				.addSubcommand((sub) => sub.setName('optin').setDescription('Undo a previous opt-out'))
				.addSubcommandGroup((group) =>
					group
						.setName('follow')
						.setDescription('Have me join your voice channel when you do')
						.addSubcommand((sub) => sub.setName('on').setDescription('Join my voice channel shortly after I join one'))
						.addSubcommand((sub) => sub.setName('off').setDescription("Stop following me — I'll stay wherever I am"))
						.addSubcommand((sub) => sub.setName('status').setDescription('Show whether I follow you, and how long I wait'))
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		}

		const group = interaction.options.getSubcommandGroup(false);
		const sub = interaction.options.getSubcommand(true);
		const guildId = interaction.guildId;
		const member = interaction.member as GuildMember;

		// Following is a personal setting like opt-out, so it is not DJ-gated either: it only
		// ever brings me into a channel the member is already sitting in.
		if (group === 'follow') return this.runFollow(interaction, guildId, member, sub);

		// Opt-out is a personal privacy control, so it is never gated behind DJ.
		if (sub === 'optout' || sub === 'optin') {
			setVoiceOptOut(guildId, member.id, sub === 'optout');
			return interaction.reply({
				content:
					sub === 'optout'
						? "🔇 you're opted out. I won't subscribe to your audio at all, not even to ignore it."
						: "🔊 you're opted back in. I'll listen for the wake word from you again.",
				flags: MessageFlags.Ephemeral
			});
		}

		if (sub === 'status') {
			const config = getVoiceAssistantConfig(guildId);
			const active = isAssistantActive(guildId);
			return interaction.reply({
				content: [
					`**Assistant:** ${active ? '🎧 listening' : "💤 not listening (say the word and I'll wake up)"}`,
					`**Wake word:** ${config.wake_word}`,
					`**Requires DJ:** ${config.require_dj ? 'yes' : 'no'}`,
					`**Wake chime:** ${config.wake_chime ? 'on' : 'off'}`,
					// Spoken acks fall back to text when the sidecar is down, which is invisible
					// from the channel — so say so here rather than leave it a mystery.
					`**Acknowledgements:** ${config.ack_mode}${config.ack_mode === 'tts' && !(await isTtsHealthy()) ? " — can't reach the TTS sidecar, so replies come back as text" : ''}`,
					`**You:** ${isVoiceOptedOut(guildId, member.id) ? 'opted out' : 'opted in'}, ${
						isVoiceFollowEnabled(guildId, member.id) ? `followed after ${formatDelay(config.follow_delay_ms)}` : 'not followed'
					}`
				].join('\n'),
				flags: MessageFlags.Ephemeral
			});
		}

		// Starting and stopping affects everyone in the channel, so it is DJ-gated.
		if (!checkDJPermission(member, guildId)) {
			return interaction.reply({ content: '🚫 that needs the DJ role.', flags: MessageFlags.Ephemeral });
		}

		if (sub === 'off') {
			if (!isAssistantActive(guildId)) return interaction.reply({ content: "I'm not listening to begin with.", flags: MessageFlags.Ephemeral });
			await stopAssistantSession(guildId);
			return interaction.reply("👋 alright, I've stopped listening.");
		}

		const voiceChannel = member.voice.channel;
		if (!voiceChannel) return interaction.reply({ content: "get in a voice channel first, then we'll talk.", flags: MessageFlags.Ephemeral });

		await interaction.deferReply();
		const result = await startAssistantSession(interaction.guild, voiceChannel, interaction.channelId);
		if (!result.ok) return interaction.editReply(`❌ ${result.error}`);

		auditConfigMutation('voice', guildId, auditActor(member, 'discord'), () =>
			setVoiceAssistantConfig({ guild_id: guildId, enabled: true, text_channel_id: interaction.channelId })
		);
		return interaction.editReply('🎧 listening. say the wake word and tell me what you want.');
	}

	private async runFollow(interaction: Command.ChatInputCommandInteraction, guildId: string, member: GuildMember, sub: string) {
		const delay = formatDelay(getVoiceAssistantConfig(guildId).follow_delay_ms);

		if (sub === 'status') {
			const following = isVoiceFollowEnabled(guildId, member.id);
			return interaction.reply({
				content: following
					? `🐾 following you — I'll join your channel ${delay} after you do, unless I'm already in one.`
					: '🐾 not following you. `/assistant follow on` if you want me to turn up when you do.',
				flags: MessageFlags.Ephemeral
			});
		}

		setVoiceFollow(guildId, member.id, sub === 'on');
		return interaction.reply({
			content:
				sub === 'on'
					? `🐾 got it. when you join a voice channel I'll follow you in ${delay} later — as long as I'm not already listening somewhere.`
					: "🐾 no longer following you. I'll still stay put wherever I already am.",
			flags: MessageFlags.Ephemeral
		});
	}
}

/** "10 seconds", "2 minutes" — the delay reads as prose in every message it appears in. */
function formatDelay(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds === 0) return 'immediately';
	if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
	const minutes = Math.round(seconds / 60);
	return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
