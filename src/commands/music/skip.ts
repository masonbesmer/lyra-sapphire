import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { useMainPlayer } from 'discord-player';
import { GuildMember, Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'skip',
	description: 'skip the current song or skip to a specific song in the queue',
	preconditions: ['InVoiceWithBot', 'DJOnly']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option.setName('track').setDescription('The position of the track in the queue to skip to').setRequired(false)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const player = useMainPlayer();
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });

		const queue = player.nodes.get(interaction.guild);
		if (!queue || !queue.node.isPlaying()) return interaction.reply('there is nothing playing right now.');

		const trackNumber = interaction.options.getInteger('track', false);

		if (trackNumber !== null) {
			const track = queue.tracks.at(trackNumber - 1);
			if (!track) return interaction.reply('invalid track number.');
			queue.node.skipTo(track);
			return interaction.reply(`skipped to track #${trackNumber}.`);
		} else {
			queue.node.skip();
			return interaction.reply('skipped the current song.');
		}
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guildId) return message.reply('This command can only be used in a server!');
		const player = useMainPlayer();
		const queue = player.nodes.get(message.guildId);
		if (!queue || !queue.node.isPlaying()) return message.reply('there is nothing playing right now.');

		const trackNumber = await args.pick('integer').catch(() => null);
		if (trackNumber !== null) {
			const track = queue.tracks.at(trackNumber - 1);
			if (!track) return message.reply('invalid track number.');
			queue.node.skipTo(track);
			return message.reply(`skipped to track #${trackNumber}.`);
		} else {
			queue.node.skip();
			return message.reply('skipped the current song.');
		}
	}
}
