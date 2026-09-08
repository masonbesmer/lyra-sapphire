import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, GuildMember, Message, Role, ChannelType } from 'discord.js';
import { getMusicConfig, getVoiceAssistantConfig, setMusicConfig, setVoiceAssistantConfig } from '../../lib/config';
import { auditActor, auditConfigMutation } from '../../lib/audit';

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
						.addSubcommand((sub) =>
							sub
								.setName('announce-channel')
								.setDescription('Set the channel for now-playing announcements (omit to use the channel /play was run in)')
								.addChannelOption((o) =>
									o.setName('channel').setDescription('The channel to post announcements in (omit to clear)').setRequired(false)
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('idle-timeout')
								.setDescription('How long the music bot stays in voice after playback ends')
								.addIntegerOption((o) =>
									o
										.setName('seconds')
										.setDescription('Seconds of silence before disconnecting (0 never disconnects)')
										.setRequired(true)
										.setMinValue(0)
										.setMaxValue(86400)
								)
						)
				)
				.addSubcommandGroup((group) =>
					group
						.setName('voice')
						.setDescription('Configure the voice assistant')
						.addSubcommand((sub) =>
							sub
								.setName('follow-delay')
								.setDescription('How long to wait before joining a member who has /assistant follow on')
								.addIntegerOption((o) =>
									o
										.setName('seconds')
										.setDescription('Seconds to wait after they join (0 joins immediately)')
										.setRequired(true)
										.setMinValue(0)
										.setMaxValue(600)
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
		if (!interaction.inCachedGuild()) return interaction.reply({ content: "can't do that outside a server.", flags: MessageFlags.Ephemeral });
		const member = interaction.member as GuildMember;
		const ok = await this.checkAdmin(member);
		if (!ok) return interaction.reply({ content: 'you need to be a server admin for that.', flags: MessageFlags.Ephemeral });

		const group = interaction.options.getSubcommandGroup(false);
		const sub = interaction.options.getSubcommand(true);
		const guildId = interaction.guildId!;
		const actor = auditActor(member, 'discord');

		if (sub === 'view') {
			const mcfg = getMusicConfig(guildId);
			const vcfg = getVoiceAssistantConfig(guildId);
			return interaction.reply({
				content: `**Music settings:**
dj_role=${mcfg.dj_role_id ? `<@&${mcfg.dj_role_id}>` : 'None'}
default_volume=${mcfg.default_volume}
announce_tracks=${mcfg.announce_tracks ? 'on' : 'off'}
announce_channel=${mcfg.announce_channel_id ? `<#${mcfg.announce_channel_id}>` : 'None (uses the channel /play was run in)'}
idle_timeout=${formatSeconds(mcfg.idle_timeout_ms)}

**Voice settings:**
follow_delay=${formatSeconds(vcfg.follow_delay_ms)}`
			});
		}

		if (group === 'music') {
			if (sub === 'dj-role') {
				const role = interaction.options.getRole('role', false) as Role | null;
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, dj_role_id: role ? role.id : null }));
				return interaction.reply({
					content: role ? `🎵 DJ role set to <@&${role.id}>` : "🎵 DJ role restriction's gone."
				});
			}
			if (sub === 'default-volume') {
				const level = interaction.options.getInteger('level', true);
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, default_volume: level }));
				return interaction.reply({ content: `🔊 default volume's **${level}%** now.` });
			}
			if (sub === 'announce') {
				const state = interaction.options.getString('state', true) === 'on';
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, announce_tracks: state }));
				return interaction.reply({ content: `📢 track announcements: **${state ? 'on' : 'off'}**` });
			}
			if (sub === 'announce-channel') {
				const channel = interaction.options.getChannel('channel', false);
				if (channel && channel.type !== ChannelType.GuildText) {
					return interaction.reply({ content: 'that needs to be a text channel.', flags: MessageFlags.Ephemeral });
				}
				auditConfigMutation('music', guildId, actor, () =>
					setMusicConfig({ guild_id: guildId, announce_channel_id: channel ? channel.id : null })
				);
				return interaction.reply({
					content: channel ? `📢 announce channel's set to <#${channel.id}> now.` : "📢 announce channel's cleared."
				});
			}
			if (sub === 'idle-timeout') {
				const seconds = interaction.options.getInteger('seconds', true);
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, idle_timeout_ms: seconds * 1000 }));
				return interaction.reply({
					content:
						seconds === 0
							? "⏳ I'll stay in voice after the queue ends."
							: `⏳ I'll leave voice ${formatSeconds(seconds * 1000)} after playback ends.`
				});
			}
		}

		if (group === 'voice') {
			if (sub === 'follow-delay') {
				const seconds = interaction.options.getInteger('seconds', true);
				auditConfigMutation('voice', guildId, actor, () => setVoiceAssistantConfig({ guild_id: guildId, follow_delay_ms: seconds * 1000 }));
				return interaction.reply({
					content:
						seconds === 0
							? "🐾 I'll join followers as soon as they're in a channel."
							: `🐾 I'll wait ${formatSeconds(seconds * 1000)} before joining a follower.`
				});
			}
		}

		return interaction.reply({ content: 'never heard of that subcommand.', flags: MessageFlags.Ephemeral });
	}

	public override async messageRun(message: Message) {
		if (!message.guild || !message.member) return;
		const ok = await this.checkAdmin(message.member as GuildMember);
		if (!ok) return message.reply('you need to be a server admin for that.');

		const args = message.content.trim().split(/\s+/).slice(1);
		if (args.length === 0)
			return message.reply(
				'usage: `%config view` | `%config music dj-role [@role|clear]` | `%config music default-volume <1-100>` | `%config music announce <on|off>` | `%config music announce-channel [#channel|clear]` | `%config music idle-timeout <seconds>` | `%config voice follow-delay <seconds>`'
			);
		const sub = args[0];
		const guildId = message.guild.id;
		const actor = auditActor(message.member as GuildMember, 'discord');

		if (sub === 'view') {
			const mcfg = getMusicConfig(guildId);
			const vcfg = getVoiceAssistantConfig(guildId);
			return message.reply(
				`**Music settings:**\ndj_role=${mcfg.dj_role_id ? `<@&${mcfg.dj_role_id}>` : 'None'}\ndefault_volume=${mcfg.default_volume}\nannounce_tracks=${mcfg.announce_tracks ? 'on' : 'off'}\nannounce_channel=${mcfg.announce_channel_id ? `<#${mcfg.announce_channel_id}>` : 'None (uses the channel /play was run in)'}\nidle_timeout=${formatSeconds(mcfg.idle_timeout_ms)}\n\n**Voice settings:**\nfollow_delay=${formatSeconds(vcfg.follow_delay_ms)}`
			);
		}

		if (sub === 'music') {
			const msub = args[1];
			if (msub === 'dj-role') {
				const roleArg = args[2];
				if (!roleArg || roleArg === 'clear') {
					auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, dj_role_id: null }));
					return message.reply("🎵 DJ role restriction's gone.");
				}
				// Extract role ID from mention or bare ID
				const roleId = roleArg.replace(/[<@&>]/g, '');
				const role = message.guild?.roles.cache.get(roleId);
				if (!role) return message.reply("couldn't find that role. mention it or use its ID.");
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, dj_role_id: role.id }));
				return message.reply(`🎵 DJ role set to <@&${role.id}>`);
			}
			if (msub === 'default-volume') {
				const level = parseInt(args[2] ?? '');
				if (isNaN(level) || level < 1 || level > 100) return message.reply('give me a volume between 1 and 100.');
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, default_volume: level }));
				return message.reply(`🔊 default volume's **${level}%** now.`);
			}
			if (msub === 'announce') {
				const state = args[2]?.toLowerCase();
				if (state !== 'on' && state !== 'off') return message.reply('say `on` or `off`.');
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, announce_tracks: state === 'on' }));
				return message.reply(`📢 Track announcements: **${state}**`);
			}
			if (msub === 'announce-channel') {
				const channelArg = args[2];
				if (!channelArg || channelArg === 'clear') {
					auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, announce_channel_id: null }));
					return message.reply("📢 announce channel's cleared.");
				}
				const channelId = channelArg.replace(/[<#>]/g, '');
				const channel = message.guild?.channels.cache.get(channelId);
				if (!channel || channel.type !== ChannelType.GuildText) return message.reply("couldn't find that channel. mention it or use its ID.");
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, announce_channel_id: channel.id }));
				return message.reply(`📢 announce channel's set to <#${channel.id}> now.`);
			}
			if (msub === 'idle-timeout') {
				const seconds = parseInt(args[2] ?? '');
				if (isNaN(seconds) || seconds < 0 || seconds > 86400) return message.reply('give me a number of seconds between 0 and 86400.');
				auditConfigMutation('music', guildId, actor, () => setMusicConfig({ guild_id: guildId, idle_timeout_ms: seconds * 1000 }));
				return message.reply(
					seconds === 0
						? "⏳ I'll stay in voice after the queue ends."
						: `⏳ I'll leave voice ${formatSeconds(seconds * 1000)} after playback ends.`
				);
			}
			return message.reply('never heard of that. use: dj-role, default-volume, announce, announce-channel, idle-timeout');
		}

		if (sub === 'voice') {
			const vsub = args[1];
			if (vsub === 'follow-delay') {
				const seconds = parseInt(args[2] ?? '');
				if (isNaN(seconds) || seconds < 0 || seconds > 600) return message.reply('give me a number of seconds between 0 and 600.');
				auditConfigMutation('voice', guildId, actor, () => setVoiceAssistantConfig({ guild_id: guildId, follow_delay_ms: seconds * 1000 }));
				return message.reply(
					seconds === 0
						? "🐾 I'll join followers as soon as they're in a channel."
						: `🐾 I'll wait ${formatSeconds(seconds * 1000)} before joining a follower.`
				);
			}
			return message.reply('never heard of that. use: follow-delay');
		}

		return message.reply('never heard of that subcommand.');
	}
}

/** Durations are stored in ms and set in seconds, so every message about one says which. */
function formatSeconds(ms: number): string {
	if (ms <= 0) return 'never';
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}
