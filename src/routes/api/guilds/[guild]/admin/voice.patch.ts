import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { ChannelType } from 'discord.js';
import { resolveGuild, readJsonBody, requireAdmin } from '../../_helpers';
import { getVoiceAssistantConfig, setVoiceAssistantConfig, type VoiceAssistantConfig } from '../../../../../lib/config';
import { auditActor, recordConfigDiff } from '../../../../../lib/audit';

type Body = Partial<Omit<VoiceAssistantConfig, 'guild_id'>>;

const ACK_MODES = new Set(['text', 'none', 'tts']);

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;
		const { guild, member } = resolved;
		if (!requireAdmin(response, member)) return;

		const body = await readJsonBody<Body>(request);
		if (!body) return response.error(HttpCodes.BadRequest);

		const update: Body = {};

		if ('enabled' in body) {
			if (typeof body.enabled !== 'boolean') return response.error(HttpCodes.BadRequest, 'enabled must be true or false.');
			update.enabled = body.enabled;
		}

		if ('wake_word' in body) {
			const wakeWord = body.wake_word;
			if (typeof wakeWord !== 'string' || wakeWord.trim().length === 0 || wakeWord.length > 64) {
				return response.error(HttpCodes.BadRequest, 'That wake word looks wrong.');
			}
			update.wake_word = wakeWord.trim();
		}

		if ('sensitivity' in body) {
			const sensitivity = body.sensitivity;
			if (typeof sensitivity !== 'number' || !Number.isFinite(sensitivity) || sensitivity < 0 || sensitivity > 1) {
				return response.error(HttpCodes.BadRequest, 'Sensitivity has to be between 0 and 1.');
			}
			update.sensitivity = sensitivity;
		}

		if ('require_dj' in body) {
			if (typeof body.require_dj !== 'boolean') return response.error(HttpCodes.BadRequest, 'require_dj must be true or false.');
			update.require_dj = body.require_dj;
		}

		if ('ack_mode' in body) {
			if (typeof body.ack_mode !== 'string' || !ACK_MODES.has(body.ack_mode)) {
				return response.error(HttpCodes.BadRequest, 'Acknowledgement mode has to be text, tts, or none.');
			}
			update.ack_mode = body.ack_mode;
		}

		if ('text_channel_id' in body) {
			const channelId = body.text_channel_id;
			if (channelId !== null) {
				const channel = guild.channels.cache.get(String(channelId));
				if (!channel || channel.type !== ChannelType.GuildText) {
					return response.error(HttpCodes.BadRequest, 'That needs to be a text channel in this server.');
				}
			}
			update.text_channel_id = channelId ?? null;
		}

		if ('silence_ms' in body) {
			const silence = body.silence_ms;
			if (typeof silence !== 'number' || !Number.isInteger(silence) || silence < 100 || silence > 5000) {
				return response.error(HttpCodes.BadRequest, 'Silence timeout has to be between 100 and 5000 ms.');
			}
			update.silence_ms = silence;
		}

		if ('max_utterance_ms' in body) {
			const max = body.max_utterance_ms;
			if (typeof max !== 'number' || !Number.isInteger(max) || max < 1000 || max > 30000) {
				return response.error(HttpCodes.BadRequest, 'Max utterance has to be between 1000 and 30000 ms.');
			}
			update.max_utterance_ms = max;
		}

		const before = getVoiceAssistantConfig(guild.id);
		setVoiceAssistantConfig({ guild_id: guild.id, ...update });
		const after = getVoiceAssistantConfig(guild.id);
		recordConfigDiff(guild.id, auditActor(member, 'dashboard'), 'voice', before, after);
		return response.json(after);
	}
}
