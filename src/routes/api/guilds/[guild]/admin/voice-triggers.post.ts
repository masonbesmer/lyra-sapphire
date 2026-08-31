import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, readJsonBody, requireAdmin } from '../../_helpers';
import {
	deleteVoiceWordTrigger,
	getVoiceWordTriggers,
	setVoiceWordTrigger,
	type VoiceTriggerResponseType,
	type VoiceWordTrigger
} from '../../../../../lib/config';
import { auditActor, recordConfigChange } from '../../../../../lib/audit';
import { listSounds } from '../../../../../lib/voice/sounds';
import { DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS, MIN_COOLDOWN_MS } from '../../../../../lib/voice/triggers';
import { MAX_SPOKEN_CHARS } from '../../../../../lib/voice/ttsClient';

interface Body {
	action: 'set' | 'remove';
	keyword: string;
	response_type?: VoiceTriggerResponseType;
	response?: string;
	cooldown_ms?: number;
}

/**
 * The dashboard sets text triggers and points sound triggers at clips that are already
 * stored. Uploading a clip stays in Discord, under `/voicekeyword add-sound` — the file
 * arrives there as an attachment already, so a multipart path here would exist only to
 * re-solve a problem Discord has solved.
 */
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
		if (body.action !== 'set' && body.action !== 'remove') return response.error(HttpCodes.BadRequest);
		if (typeof body.keyword !== 'string' || body.keyword.trim().length === 0 || body.keyword.length > 100) {
			return response.error(HttpCodes.BadRequest, 'Give me a keyword.');
		}

		const keyword = body.keyword.trim().toLowerCase();
		const actor = auditActor(member, 'dashboard');
		const describe = (trigger: VoiceWordTrigger | undefined) => (trigger ? `${trigger.response_type}: ${trigger.response}` : null);
		const previous = describe(getVoiceWordTriggers(guild.id).find((trigger) => trigger.keyword === keyword));

		if (body.action === 'remove') {
			if (deleteVoiceWordTrigger(guild.id, keyword)) {
				recordConfigChange(guild.id, actor, 'voice_triggers', keyword, previous, null);
			}
			return response.json(getVoiceWordTriggers(guild.id));
		}

		const responseType = body.response_type ?? 'text';
		if (responseType !== 'text' && responseType !== 'sound' && responseType !== 'speak') {
			return response.error(HttpCodes.BadRequest, 'A trigger replies with text, says something out loud, or plays a sound.');
		}

		if (typeof body.response !== 'string' || body.response.trim().length === 0) {
			return response.error(HttpCodes.BadRequest, responseType === 'sound' ? 'Pick a sound.' : 'Give me a response.');
		}
		const value = body.response.trim();

		if (responseType === 'text' && value.length > 2000) {
			return response.error(HttpCodes.BadRequest, 'Give me a response of 1-2000 characters.');
		}
		// Rejected rather than truncated: the synthesiser would cut it at the same point, and a
		// trigger that says two thirds of what it was given is worse than one that refused.
		if (responseType === 'speak' && value.length > MAX_SPOKEN_CHARS) {
			return response.error(HttpCodes.BadRequest, `Something to say out loud has to be ${MAX_SPOKEN_CHARS} characters or fewer.`);
		}
		// A sound trigger that names a clip nobody uploaded is silently dead at runtime, so it
		// is rejected here rather than discovered later.
		if (responseType === 'sound' && !listSounds(guild.id).includes(value)) {
			return response.error(HttpCodes.BadRequest, 'No clip stored under that name. Upload one with /voicekeyword add-sound.');
		}

		const cooldown = body.cooldown_ms ?? DEFAULT_COOLDOWN_MS;
		if (!Number.isInteger(cooldown) || cooldown < MIN_COOLDOWN_MS || cooldown > MAX_COOLDOWN_MS) {
			return response.error(
				HttpCodes.BadRequest,
				`Cooldown has to be between ${MIN_COOLDOWN_MS / 1000} and ${MAX_COOLDOWN_MS / 1000} seconds.`
			);
		}

		const trigger: VoiceWordTrigger = { keyword, response_type: responseType, response: value, cooldown_ms: cooldown };
		setVoiceWordTrigger(guild.id, trigger);
		recordConfigChange(guild.id, actor, 'voice_triggers', keyword, previous, describe(trigger));
		return response.json(getVoiceWordTriggers(guild.id));
	}
}
