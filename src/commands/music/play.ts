import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command } from '@sapphire/framework';
import { GuildMember, Message } from 'discord.js';
import { getMusicConfig } from '../../lib/config';
import { getOrCreatePlayer, initPlayerMeta, queueAndLabel } from '../../lib/musicCommandHelpers';

@ApplyOptions<Command.Options>({
	name: 'play',
	description: 'play music!',
	preconditions: ['InVoiceWithBot']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) => option.setName('query').setDescription('The song to play').setRequired(true).setAutocomplete(true))
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		const query = interaction.options.getString('query', true);
		if (!query.trim()) return interaction.respond([]);
		try {
			const result = await this.container.client.kazagumo.search(query, { requester: interaction.user });
			const choices = result.tracks.slice(0, 5).map((t) => ({
				name: `${t.title} — ${t.author ?? ''}`.slice(0, 100),
				value: t.uri ?? t.title
			}));
			return interaction.respond(choices);
		} catch {
			return interaction.respond([]);
		}
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply({ content: 'Use in a server', ephemeral: true });
		const member = interaction.member as GuildMember;
		const channel = member.voice.channel!;
		const query = interaction.options.getString('query', true);
		const cfg = getMusicConfig(interaction.guildId);

		await interaction.deferReply();

		try {
			const kazagumo = this.container.client.kazagumo;
			const result = await kazagumo.search(query, { requester: interaction.user });
			if (!result.tracks.length) return interaction.followUp('❌ No results found.');

			const player = await getOrCreatePlayer(kazagumo, {
				guildId: interaction.guildId,
				voiceId: channel.id,
				textId: interaction.channelId,
				volume: cfg.default_volume
			});
			initPlayerMeta(player, { interaction, channelId: interaction.channelId, requestedBy: interaction.user });
			return interaction.followUp(await queueAndLabel(player, result));
		} catch (e) {
			this.container.logger.error(`[play] ${String(e)}`);
			return interaction.followUp('something went wrong, check the logs');
		}
	}

	public override async messageRun(message: Message, args: Args) {
		if (!message.guild || !message.guildId || !(message.member instanceof GuildMember)) {
			return message.reply('This command can only be used in a server!');
		}
		const channel = message.member.voice.channel;
		if (!channel) return message.reply("you aren't in a voice channel.");

		const query = await args.rest('string').catch(() => null);
		if (!query) return message.reply('Please provide a song name or URL. Example: `%play never gonna give you up`');

		const cfg = getMusicConfig(message.guildId);
		const statusMsg = await message.reply('🔍 Searching...');

		try {
			const kazagumo = this.container.client.kazagumo;
			const result = await kazagumo.search(query, { requester: message.author });
			if (!result.tracks.length) return statusMsg.edit('❌ No results found.');

			const player = await getOrCreatePlayer(kazagumo, {
				guildId: message.guildId,
				voiceId: channel.id,
				textId: message.channelId,
				volume: cfg.default_volume
			});
			initPlayerMeta(player, { interaction: message, channelId: message.channelId, requestedBy: message.author });
			return statusMsg.edit(await queueAndLabel(player, result));
		} catch (e) {
			this.container.logger.error(`[play] ${String(e)}`);
			return statusMsg.edit('something went wrong, check the logs');
		}
	}
}
