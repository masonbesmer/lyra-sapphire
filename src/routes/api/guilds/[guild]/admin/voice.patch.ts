import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { ChannelType } from 'discord.js';
import { resolveGuild, readJsonBody, requireAdmin } from '../../_helpers';
import { getVoiceAssistantConfig, setVoiceAssistantConfig, type VoiceAssistantConfig } from '../../../../../lib/config';
import { auditActor, recordConfigDiff } from '../../../../../lib/audit';

type Body = Partial<Omit<VoiceAssistantConfig, 'guild_id' | 'google_api_key_set'>> & { google_api_key?: string | null };

const ACK_MODES = new Set(['text', 'none', 'tts']);
const PROVIDERS = new Set(['local', 'google']);
/** BCP-47-ish: `en-US`, `cmn-Hans-CN`. Loose on purpose; Google rejects what it can't use. */
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
/** `en-US-Neural2-F`, `en-GB-Chirp3-HD-Aoede`. */
const VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]{1,48}$/;

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

		if ('wake_chime' in body) {
			if (typeof body.wake_chime !== 'boolean') return response.error(HttpCodes.BadRequest, 'wake_chime must be true or false.');
			update.wake_chime = body.wake_chime;
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

		if ('follow_delay_ms' in body) {
			const followDelay = body.follow_delay_ms;
			// 0 means join the moment they arrive; ten minutes is as long a wait as is useful.
			if (typeof followDelay !== 'number' || !Number.isInteger(followDelay) || followDelay < 0 || followDelay > 600_000) {
				return response.error(HttpCodes.BadRequest, 'Follow delay has to be between 0 and 600000 ms.');
			}
			update.follow_delay_ms = followDelay;
		}

		if ('google_api_key' in body) {
			const key = body.google_api_key;
			// null or '' clears it; the guild then uses the deployment's GEMINI_API_KEY, if any.
			if (key !== null && (typeof key !== 'string' || key.length > 200 || /\s/.test(key.trim()))) {
				return response.error(HttpCodes.BadRequest, "That doesn't look like a Google API key.");
			}
			update.google_api_key = key?.trim() || null;
		}

		for (const field of ['stt_provider', 'tts_provider'] as const) {
			if (field in body) {
				const value = body[field];
				if (typeof value !== 'string' || !PROVIDERS.has(value))
					return response.error(HttpCodes.BadRequest, `${field} has to be local or google.`);
				update[field] = value;
			}
		}

		if ('stt_language' in body) {
			if (typeof body.stt_language !== 'string' || !LANGUAGE.test(body.stt_language)) {
				return response.error(HttpCodes.BadRequest, 'Speech language has to be a code like en-US.');
			}
			update.stt_language = body.stt_language;
		}

		if ('tts_voice' in body) {
			if (typeof body.tts_voice !== 'string' || !VOICE.test(body.tts_voice)) {
				return response.error(HttpCodes.BadRequest, 'Voice has to be a Google voice name like en-US-Neural2-F.');
			}
			update.tts_voice = body.tts_voice;
		}

		const before = getVoiceAssistantConfig(guild.id);
		setVoiceAssistantConfig({ guild_id: guild.id, ...update });
		const after = getVoiceAssistantConfig(guild.id);
		recordConfigDiff(guild.id, auditActor(member, 'dashboard'), 'voice', before, after);
		return response.json(after);
	}
}
