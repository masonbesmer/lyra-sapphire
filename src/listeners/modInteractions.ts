import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	TextInputBuilder,
	TextInputStyle,
	type ButtonInteraction,
	type Interaction,
	type ModalSubmitInteraction
} from 'discord.js';
import { displayCaptcha, getAntiRaidConfig } from '../lib/antiRaid';
import { captchas, completeVerification, endRaidMode, issueCaptcha, verifyProblem } from '../lib/antiRaidActions';
import { MOD_PREFIX } from '../lib/modButtons';
import { ModError, describeError } from '../lib/modActions';
import { MAX_APPEAL_LENGTH, MAX_REPORT_REASON } from '../lib/modQueue';
import {
	assertCanAppeal,
	closeTicketThread,
	fileReport,
	handleAppealButton,
	handleReportButton,
	openTicket,
	submitAppeal
} from '../lib/modQueueActions';

type Answerable = ButtonInteraction | ModalSubmitInteraction;

/**
 * Routes every `mod:` button and modal (LYRA-12): report actions, tickets, ban appeals, the
 * raid alert and the verification gate. Buttons can't go through command preconditions, so each
 * handler checks the clicker's Discord permission itself.
 */
export class ModInteractionsListener extends Listener {
	public constructor(context: Listener.LoaderContext, options: Listener.Options) {
		super(context, { ...options, event: 'interactionCreate' });
	}

	public async run(interaction: Interaction) {
		if (!interaction.isButton() && !interaction.isModalSubmit()) return;
		if (!interaction.customId.startsWith(MOD_PREFIX)) return;
		const [kind, action, ...rest] = interaction.customId.slice(MOD_PREFIX.length).split(':');
		try {
			if (interaction.isButton()) await this.button(interaction, kind, action, rest);
			else await this.modal(interaction, kind, action, rest);
		} catch (error) {
			await this.reply(interaction, `❌ ${describeError(error)}`);
		}
	}

	private async button(interaction: ButtonInteraction, kind: string, action: string, rest: string[]) {
		// Buttons that work in DMs: appeals (the member is banned) and the modmail prompt.
		if (kind === 'appeal' && action === 'open') {
			const guild = await assertCanAppeal(rest[0], interaction.user);
			return interaction.showModal(
				new ModalBuilder()
					.setCustomId(`${MOD_PREFIX}appeal-modal:${guild.id}`)
					.setTitle(`Appeal your ban from ${guild.name}`.slice(0, 45))
					.addComponents(
						new ActionRowBuilder<TextInputBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId('appeal')
								.setLabel('Why should you be unbanned?')
								.setStyle(TextInputStyle.Paragraph)
								.setMinLength(20)
								.setMaxLength(MAX_APPEAL_LENGTH)
								.setRequired(true)
						)
					)
			);
		}
		if (kind === 'ticket' && action === 'dm') return this.ticketFromDm(interaction, rest[0], rest[1]);

		if (!interaction.inCachedGuild()) throw new ModError('that only works in a server.');
		const { member, guild } = interaction;

		if (kind === 'report') return this.deferred(interaction, () => handleReportButton(interaction, action, Number(rest[0])));
		if (kind === 'appeal') return this.deferred(interaction, () => handleAppealButton(interaction, action, Number(rest[0])));

		if (kind === 'ticket' && action === 'open') {
			return this.deferred(interaction, async () => {
				const { thread, existing } = await openTicket(guild, interaction.user, null);
				return existing ? `you already have a ticket open: <#${thread.id}>` : `📩 ticket opened: <#${thread.id}>`;
			});
		}
		if (kind === 'ticket' && action === 'close') {
			const channel = interaction.channel;
			if (!channel?.isThread()) throw new ModError("this isn't a ticket thread.");
			return this.deferred(interaction, () => closeTicketThread(channel, member, null));
		}

		if (kind === 'raid' && action === 'end') {
			if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new ModError('you need **Manage Server** to end raid mode.');
			return this.deferred(interaction, () => endRaidMode(guild, member.id));
		}

		if (kind === 'verify') {
			const config = getAntiRaidConfig(guild.id);
			const problem = verifyProblem(member, config);
			if (problem) throw new ModError(problem);
			if (action === 'start' && config.verify_mode === 'button') return this.deferred(interaction, () => completeVerification(member, config));
			if (action === 'start') {
				const code = issueCaptcha(member);
				return interaction.reply({
					content: `Your code is **${displayCaptcha(code)}**\nPress the button and type it in (letters and numbers only). It expires in 5 minutes.`,
					components: [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder().setCustomId(`${MOD_PREFIX}verify:code`).setLabel('Enter code').setStyle(ButtonStyle.Primary)
						)
					],
					flags: MessageFlags.Ephemeral
				});
			}
			if (action === 'code') {
				return interaction.showModal(
					new ModalBuilder()
						.setCustomId(`${MOD_PREFIX}verify-modal:${guild.id}`)
						.setTitle('Verification')
						.addComponents(
							new ActionRowBuilder<TextInputBuilder>().addComponents(
								new TextInputBuilder()
									.setCustomId('code')
									.setLabel('The code you were shown')
									.setStyle(TextInputStyle.Short)
									.setMaxLength(20)
							)
						)
				);
			}
		}
		throw new ModError("that button doesn't do anything anymore.");
	}

	private async modal(interaction: ModalSubmitInteraction, kind: string, _action: string, rest: string[]) {
		if (kind === 'appeal-modal') {
			const guildId = interaction.customId.split(':')[2];
			return this.deferred(interaction, () => submitAppeal(guildId, interaction.user, interaction.fields.getTextInputValue('appeal')));
		}

		if (!interaction.inCachedGuild()) throw new ModError('that only works in a server.');
		const { member, guild } = interaction;

		if (kind === 'report-modal') {
			// mod:report-modal:<channelId>:<messageId>
			const [channelId, messageId] = [_action, rest[0]];
			return this.deferred(interaction, async () => {
				const channel = guild.channels.cache.get(channelId);
				if (!channel?.isTextBased()) throw new ModError("I can't find that channel anymore.");
				const message = await channel.messages.fetch(messageId).catch(() => null);
				if (!message) throw new ModError('that message is gone already.');
				return fileReport({
					guild,
					reporter: interaction.user,
					target: message.author,
					reason: interaction.fields.getTextInputValue('reason').slice(0, MAX_REPORT_REASON),
					message
				});
			});
		}

		if (kind === 'verify-modal') {
			const config = getAntiRaidConfig(guild.id);
			const problem = verifyProblem(member, config);
			if (problem) throw new ModError(problem);
			const result = captchas.check(guild.id, member.id, interaction.fields.getTextInputValue('code'));
			if (result === 'expired') throw new ModError('that code expired. press **Verify** again for a new one.');
			if (result === 'wrong') throw new ModError("that's not the code. press **Verify** again for a new one.");
			return this.deferred(interaction, () => completeVerification(member, config));
		}
		throw new ModError("that form doesn't do anything anymore.");
	}

	/** Modmail: the member picked a server from the DM prompt. Their DM becomes the ticket's first message. */
	private async ticketFromDm(interaction: ButtonInteraction, guildId: string, messageId: string) {
		const guild = this.container.client.guilds.cache.get(guildId);
		if (!guild) throw new ModError("I'm not in that server anymore.");
		await interaction.deferUpdate();
		const original = await interaction.channel?.messages.fetch(messageId).catch(() => null);
		const { thread, existing } = await openTicket(guild, interaction.user, null, original?.content || null);
		if (existing && original?.content) {
			await thread.send({
				content: `<@${interaction.user.id}> (from DMs):\n>>> ${original.content.slice(0, 1800)}`,
				allowedMentions: { parse: [] }
			});
		}
		await interaction.editReply({
			content: `${existing ? 'Added to your open ticket' : 'Ticket opened'} in **${guild.name}**: ${thread.url}\nKeep talking to the moderators there.`,
			components: []
		});
	}

	private async deferred(interaction: Answerable, run: () => Promise<string>) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const text = await run();
		await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
	}

	private async reply(interaction: Answerable, content: string) {
		try {
			if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], allowedMentions: { parse: [] } });
			else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
		} catch (error) {
			this.container.logger.debug(`[moderation] couldn't answer ${interaction.customId}: ${String(error)}`);
		}
	}
}
