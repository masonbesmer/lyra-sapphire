import { AllFlowsPrecondition } from '@sapphire/framework';
import type { CommandInteraction, ContextMenuCommandInteraction, Message } from 'discord.js';
import { GuildMember } from 'discord.js';

export class UserPrecondition extends AllFlowsPrecondition {
	#noVoice = "hey dumbass, you aren't in a voice channel.";
	#wrongChannel = 'join my voice channel to control the player.';

	public override chatInputRun(interaction: CommandInteraction) {
		return this.shared(interaction);
	}

	public override contextMenuRun(interaction: ContextMenuCommandInteraction) {
		return this.shared(interaction);
	}

	public override messageRun(message: Message) {
		if (!(message.member instanceof GuildMember)) return this.error({ message: this.#noVoice });
		return this.checkMember(message.member);
	}

	private shared(interaction: CommandInteraction | ContextMenuCommandInteraction) {
		if (!interaction.inCachedGuild()) return this.error({ message: this.#noVoice });
		return this.checkMember(interaction.member as GuildMember);
	}

	private checkMember(member: GuildMember) {
		const userChannel = member.voice.channel;
		if (!userChannel) return this.error({ message: this.#noVoice });
		const botChannel = member.guild.members.me?.voice.channel;
		if (botChannel && botChannel.id !== userChannel.id) return this.error({ message: this.#wrongChannel });
		return this.ok();
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		InVoiceWithBot: never;
	}
}
