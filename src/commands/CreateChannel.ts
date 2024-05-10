import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { CategoryChannel, ChannelType } from 'discord.js';

@ApplyOptions<Command.Options>({
	description: 'debug command to create a channel'
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) =>
					option //
						.setName('name')
						.setDescription('The name of the channel')
						.setRequired(true)
				)
				.addIntegerOption((option) =>
					option //
						.setName('categoryID')
						.setDescription('The category ID to place the channel under')
						.setRequired(true)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const guild = interaction.guild;
		const channelName = interaction.options.getString('name', true);
		let category: CategoryChannel | null = null;
		let catID = interaction.options.getInteger('categoryID')?.toString();
		if (catID && guild) {
			category = guild.channels.cache.get(catID) as CategoryChannel;
		}
		if (!category) {
			return interaction.reply('Category not found');
		}
		// public create<Type extends GuildChannelTypes>( options: GuildChannelCreateOptions & { type: Type },)
		try {
			const channel = await interaction.guild?.channels.create({
				name: channelName,
				type: ChannelType.GuildText,
				parent: category.id
			});
			return interaction.reply(`Successfully created channel: ${channel?.name}`);
		} catch (error) {
			return interaction.reply(`Error creating channel: ${error}`);
		}
	}
}
