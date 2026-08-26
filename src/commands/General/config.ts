import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, GuildMember, Message, Role } from 'discord.js';
import { getMusicConfig, setMusicConfig } from '../../lib/config';

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

		if (sub === 'view') {
			const mcfg = getMusicConfig(guildId);
			return interaction.reply({
				content: `**Music settings:**
dj_role=${mcfg.dj_role_id ? `<@&${mcfg.dj_role_id}>` : 'None'}
default_volume=${mcfg.default_volume}
announce_tracks=${mcfg.announce_tracks ? 'on' : 'off'}`
			});
		}

		if (group === 'music') {
			if (sub === 'dj-role') {
				const role = interaction.options.getRole('role', false) as Role | null;
				setMusicConfig({ guild_id: guildId, dj_role_id: role ? role.id : null });
				return interaction.reply({
					content: role ? `🎵 DJ role set to <@&${role.id}>` : "🎵 DJ role restriction's gone."
				});
			}
			if (sub === 'default-volume') {
				const level = interaction.options.getInteger('level', true);
				setMusicConfig({ guild_id: guildId, default_volume: level });
				return interaction.reply({ content: `🔊 default volume's **${level}%** now.` });
			}
			if (sub === 'announce') {
				const state = interaction.options.getString('state', true) === 'on';
				setMusicConfig({ guild_id: guildId, announce_tracks: state });
				return interaction.reply({ content: `📢 track announcements: **${state ? 'on' : 'off'}**` });
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
				'usage: `%config view` | `%config music dj-role [@role|clear]` | `%config music default-volume <1-100>` | `%config music announce <on|off>`'
			);
		const sub = args[0];
		const guildId = message.guild.id;

		if (sub === 'view') {
			const mcfg = getMusicConfig(guildId);
			return message.reply(
				`**Music settings:**\ndj_role=${mcfg.dj_role_id ? `<@&${mcfg.dj_role_id}>` : 'None'}\ndefault_volume=${mcfg.default_volume}\nannounce_tracks=${mcfg.announce_tracks ? 'on' : 'off'}`
			);
		}

		if (sub === 'music') {
			const msub = args[1];
			if (msub === 'dj-role') {
				const roleArg = args[2];
				if (!roleArg || roleArg === 'clear') {
					setMusicConfig({ guild_id: guildId, dj_role_id: null });
					return message.reply("🎵 DJ role restriction's gone.");
				}
				// Extract role ID from mention or bare ID
				const roleId = roleArg.replace(/[<@&>]/g, '');
				const role = message.guild?.roles.cache.get(roleId);
				if (!role) return message.reply("couldn't find that role. mention it or use its ID.");
				setMusicConfig({ guild_id: guildId, dj_role_id: role.id });
				return message.reply(`🎵 DJ role set to <@&${role.id}>`);
			}
			if (msub === 'default-volume') {
				const level = parseInt(args[2] ?? '');
				if (isNaN(level) || level < 1 || level > 100) return message.reply('give me a volume between 1 and 100.');
				setMusicConfig({ guild_id: guildId, default_volume: level });
				return message.reply(`🔊 default volume's **${level}%** now.`);
			}
			if (msub === 'announce') {
				const state = args[2]?.toLowerCase();
				if (state !== 'on' && state !== 'off') return message.reply('say `on` or `off`.');
				setMusicConfig({ guild_id: guildId, announce_tracks: state === 'on' });
				return message.reply(`📢 Track announcements: **${state}**`);
			}
			return message.reply('never heard of that. use: dj-role, default-volume, announce');
		}

		return message.reply('never heard of that subcommand.');
	}
}
