import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Message } from 'discord.js';

@ApplyOptions<Listener.Options>({
	event: 'messageCreate'
})
export class UserEvent extends Listener {
	public override run(message: Message) {
		if (message.author.bot) return;

		const msgText = message.content.toLowerCase();

		// Define all triggers as objects with match and reply logic
		const triggers = [
			{
				match: () => msgText.includes('bee'),
				reply: () => {
					this.container.logger.debug('Replying to "Bee" trigger');
					message.reply(
						"According to all known laws of aviation, there is no way a bee should be able to fly. Its wings are too small to get its fat little body off the ground. The bee, of course, flies anyway because bees don't care what humans think is impossible."
					);
				}
			},
			{
				match: () => msgText.includes('greg'),
				reply: () => {
					this.container.logger.debug('Replying to "Greg" trigger');
					message.reply('did someone say [greg](https://gregtech.overminddl1.com/static/images/logo_gt_site.svg)?');
				}
			},
			{
				match: () => msgText.includes('was'),
				reply: () => {
					this.container.logger.debug('Replying to "Was" trigger');
					message.reply('was was');
				}
			},
			{
				match: () => msgText.includes('bomb'),
				reply: () => {
					this.container.logger.debug('Replying to "Bomb" trigger');
					message.reply(':bomb:');
				}
			},
			{
				match: () => msgText.includes('die'),
				reply: () => {
					this.container.logger.debug('Replying to "Die" trigger');
					message.reply('immediately');
				}
			}
		];

		// Filter triggers that match
		const matched = triggers.filter(trigger => trigger.match());
		if (matched.length === 0) return;

		// Shuffle matched triggers
		for (let i = matched.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[matched[i], matched[j]] = [matched[j], matched[i]];
		}

		// Respond to each trigger in random order
		for (const trigger of matched) {
			trigger.reply();
		}
		return;
	}
}