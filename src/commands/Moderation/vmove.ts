import { ApplyOptions } from '@sapphire/decorators';
import type { Args, Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type Message, type VoiceBasedChannel } from 'discord.js';
import { ModError, respond, snowflakeFrom } from '../../lib/modActions';
import { ModCommand, type ModCommandOptions, contextOf, pickUser, restText, usage } from '../../lib/modCommand';
import { voiceMove } from '../../lib/modVoice';

const USAGE = '`%vmove @user #voice-channel [reason]`';

@ApplyOptions<ModCommandOptions>({
	name: 'vmove',
	description: 'Move a member to another voice channel',
	permission: PermissionFlagsBits.MoveMembers
})
export class VmoveCommand extends ModCommand {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			this.base(builder)
				.addUserOption((o) => o.setName('user').setDescription('Who to move').setRequired(true))
				.addChannelOption((o) =>
					o
						.setName('channel')
						.setDescription('Where to move them')
						.setRequired(true)
						.addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
				)
				.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512))
		);
	}

	public override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		return respond(interaction, () => {
			const context = contextOf(interaction);
			const channel = context.guild.channels.cache.get(interaction.options.getChannel('channel', true).id);
			if (!channel?.isVoiceBased()) throw new ModError("that isn't a voice channel.");
			return voiceMove(
				context,
				interaction.options.getUser('user', true),
				channel as VoiceBasedChannel,
				interaction.options.getString('reason')
			);
		});
	}

	public override messageRun(message: Message, args: Args) {
		return respond(message, async () => {
			const context = contextOf(message);
			const user = await pickUser(args);
			const channelId = snowflakeFrom(await args.pick('string').catch(() => null));
			if (!user || !channelId) usage(USAGE);
			const channel = context.guild.channels.cache.get(channelId);
			if (!channel?.isVoiceBased()) throw new ModError("that isn't a voice channel.");
			return voiceMove(context, user, channel, await restText(args));
		});
	}
}
