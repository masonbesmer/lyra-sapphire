import { HttpCodes } from '@sapphire/plugin-api';
import { describe, expect, it, vi } from 'vitest';
import { getGoogleSpeechApiKey, getVoiceAssistantConfig } from '../../../../../../src/lib/config';
import { UserRoute } from '../../../../../../src/routes/api/guilds/[guild]/admin/voice.patch';

const GUILD = 'voice-route-guild';
const guild = { id: GUILD, channels: { cache: new Map() } };
const member = { id: 'admin', user: { username: 'admin' } };
let body: unknown;

vi.mock('../../../../../../src/routes/api/guilds/_helpers', () => ({
	resolveGuild: async () => ({ guild, member }),
	requireAdmin: () => true,
	readJsonBody: async () => body
}));

async function patch(payload: unknown) {
	body = payload;
	const response = { json: vi.fn(), error: vi.fn() };
	const route = Object.create(UserRoute.prototype) as UserRoute;
	await route.run({ params: { guild: GUILD } } as never, response as never);
	return response;
}

describe('PATCH admin/voice google cloud', () => {
	it('defaults to the local stack', () => {
		expect(getVoiceAssistantConfig(GUILD)).toMatchObject({ stt_provider: 'local', tts_provider: 'local' });
	});

	it('refuses to turn on cloud voice without a speech key', async () => {
		const response = await patch({ stt_provider: 'google', tts_provider: 'google' });
		expect(response.error).toHaveBeenCalledWith(HttpCodes.BadRequest, expect.stringContaining('Speech API key'));
		expect(getVoiceAssistantConfig(GUILD).stt_provider).toBe('local');
	});

	it('turns it on with a key in the same save, and never echoes the key', async () => {
		const response = await patch({ stt_provider: 'google', tts_provider: 'google', google_speech_api_key: 'speech-key' });
		expect(response.error).not.toHaveBeenCalled();
		expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ stt_provider: 'google', google_speech_api_key_set: true }));
		expect(JSON.stringify(response.json.mock.calls)).not.toContain('speech-key');
		expect(getGoogleSpeechApiKey(GUILD)).toBe('speech-key');
	});

	it('falls back to local when the speech key is cleared', async () => {
		await patch({ google_speech_api_key: null });
		expect(getVoiceAssistantConfig(GUILD)).toMatchObject({ stt_provider: 'local', tts_provider: 'local', google_speech_api_key_set: false });
	});
});
