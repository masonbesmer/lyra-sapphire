import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, GuildMember } from 'discord.js';
import { getVoiceAssistantConfig, isVoiceOptedOut, setVoiceAssistantConfig, setVoiceOptOut } from '../../lib/config';
import { auditActor, auditConfigMutation } from '../../lib/audit';
import { checkDJPermission } from '../../lib/music';
import { isAssistantActive, startAssistantSession, stopAssistantSession } from '../../lib/voice/session';

@ApplyOptions<Command.Options>({
	name: 'assistant',
	description: 'Control the wake-word voice assistant',
	preconditions: ['InVoiceWithBot']
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
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		}

		const sub = interaction.options.getSubcommand(true);
		const guildId = interaction.guildId;
		const member = interaction.member as GuildMember;

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
					`**Spoken triggers:** ${config.triggers_enabled ? '🎙️ on — everything said is transcribed and checked for keywords' : 'off — only the wake word is matched'}`,
					`**Requires DJ:** ${config.require_dj ? 'yes' : 'no'}`,
					`**Acknowledgements:** ${config.ack_mode}`,
					`**You:** ${isVoiceOptedOut(guildId, member.id) ? 'opted out' : 'opted in'}`
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
}
