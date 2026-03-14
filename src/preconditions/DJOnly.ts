import { AllFlowsPrecondition } from '@sapphire/framework';
import type { CommandInteraction, ContextMenuCommandInteraction, Message } from 'discord.js';
import { GuildMember } from 'discord.js';
import { checkDJPermission } from '../lib/music';

export class UserPrecondition extends AllFlowsPrecondition {
	#noPermission = '🚫 You need the DJ role to use this command.';

	public override chatInputRun(interaction: CommandInteraction) {
		if (!interaction.inCachedGuild()) return this.error({ message: this.#noPermission });
		return this.checkMember(interaction.member as GuildMember, interaction.guildId);
	}

	public override contextMenuRun(interaction: ContextMenuCommandInteraction) {
		if (!interaction.inCachedGuild()) return this.error({ message: this.#noPermission });
		return this.checkMember(interaction.member as GuildMember, interaction.guildId);
	}

	public override messageRun(message: Message) {
		if (!message.guildId || !(message.member instanceof GuildMember)) return this.error({ message: this.#noPermission });
		return this.checkMember(message.member, message.guildId);
	}

	private checkMember(member: GuildMember, guildId: string) {
		if (checkDJPermission(member, guildId)) return this.ok();
		return this.error({ message: this.#noPermission });
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		DJOnly: never;
	}
}
