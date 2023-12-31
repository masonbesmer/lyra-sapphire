import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Message } from 'discord.js';

@ApplyOptions<Listener.Options>({
	event: 'messageCreate'
})
export class UserEvent extends Listener {
	public override run(message: Message) {
		if (message.author === this.container.client.user) return;

		const msgText = message.content.toLowerCase();

		if (msgText.includes('bee')) {
			this.container.logger.debug('Replying to "Bee" trigger');
			message.channel.send(
				"According to all known laws of aviation, there is no way a bee should be able to fly. Its wings are too small to get its fat little body off the ground. The bee, of course, flies anyway because bees don't care what humans think is impossible."
			);
		}
		if (msgText.includes('greg')) {
			this.container.logger.debug('Replying to "Greg" trigger');
			message.channel.send('did someone say [greg](https://gregtech.overminddl1.com/static/images/logo_gt_site.svg)?');
		}
		if (msgText.includes('was')) {
			this.container.logger.debug('Replying to "Was" trigger');
			message.channel.send('was was');
		}
		if (msgText.includes('bomb')) {
			this.container.logger.debug('Replying to "Bomb" trigger');
			message.channel.send(':bomb:');
		}
		if (msgText.includes('die')) {
			this.container.logger.debug('Replying to "Die" trigger');
			message.channel.send('immediately');
		}
		return;
	}
}
