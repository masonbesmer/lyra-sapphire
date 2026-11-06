import { container } from '@sapphire/framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/voice/musicClient', () => ({ getMusicBotChannelId: vi.fn(() => null) }));
vi.mock('../../../src/lib/voice/playback', () => ({ playSpeech: vi.fn(async () => true), playAlarm: vi.fn(async () => true) }));
vi.mock('../../../src/lib/voice/ttsClient', () => ({ synthesize: vi.fn(async () => null) }));
vi.mock('../../../src/lib/voice/weather', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../src/lib/voice/weather')>()),
	geocode: vi.fn(),
	fetchWeather: vi.fn()
}));

import { setMusicConfig, setVoiceAssistantConfig, type VoiceAssistantConfig } from '../../../src/lib/config';
import { db } from '../../../src/lib/database';
import { dispatch, reportUnknownCommand } from '../../../src/lib/voice/dispatch';
import { parse, type ParsedIntent } from '../../../src/lib/voice/intents';
import { cancel, list } from '../../../src/lib/voice/timers';
import { getMusicBotChannelId } from '../../../src/lib/voice/musicClient';
import { playSpeech } from '../../../src/lib/voice/playback';
import { synthesize } from '../../../src/lib/voice/ttsClient';
import { fetchWeather, geocode } from '../../../src/lib/voice/weather';

const USER = 'speaker';
const TEXT_CHANNEL = 'text-1';

let sent: string[];
let player:
	{ data: Map<string, unknown>; volume: number; skip: ReturnType<typeof vi.fn>; setVolume: ReturnType<typeof vi.fn>; queue: unknown[] } | undefined;
let guildCounter = 0;
let guildId: string;

function member(overrides: Record<string, unknown> = {}) {
	return {
		id: USER,
		displayName: 'Speaker',
		user: { id: USER },
		voice: { channelId: 'voice-1', channel: null },
		permissions: { has: () => false },
		guild: { roles: { cache: new Map([['dj', {}]]) } },
		roles: { cache: new Map() },
		...overrides
	};
}

function install(speaker: ReturnType<typeof member> | null) {
	const members = new Map(speaker ? [[USER, speaker]] : []);
	(container as any).client = {
		guilds: { cache: new Map([[guildId, { members: { cache: members, fetch: async () => Promise.reject(new Error('unknown member')) } }]]) },
		channels: { cache: new Map([[TEXT_CHANNEL, { isTextBased: () => true, send: async (content: string) => sent.push(content) }]]) },
		kazagumo: { getPlayer: () => player }
	};
}

function configure(config: Partial<VoiceAssistantConfig> = {}) {
	setVoiceAssistantConfig({ guild_id: guildId, require_dj: false, ...config });
}

function intent(transcript: string): ParsedIntent {
	return parse(transcript)!;
}

function logged() {
	return db.prepare('SELECT intent, dispatched FROM voice_command_log WHERE guild_id = ? ORDER BY id').all(guildId);
}

beforeEach(() => {
	guildId = `dispatch-${++guildCounter}`;
	sent = [];
	player = { data: new Map(), volume: 50, skip: vi.fn(), setVolume: vi.fn(async (volume: number) => (player!.volume = volume)), queue: [] };
	(container as any).logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
	vi.mocked(getMusicBotChannelId).mockReturnValue(null);
	vi.mocked(synthesize).mockResolvedValue(null);
	vi.mocked(playSpeech).mockClear();
	install(member());
});

describe('dispatch authorisation', () => {
	it('denies a speaker who is not in the guild', async () => {
		configure();
		install(null);
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(sent).toEqual([`🚫 <@${USER}> couldn't find you in this server.`]);
		expect(player!.skip).not.toHaveBeenCalled();
		expect(logged()).toEqual([{ intent: 'skip', dispatched: 0 }]);
	});

	it('denies a speaker in a different channel from the bot', async () => {
		configure();
		vi.mocked(getMusicBotChannelId).mockReturnValue('voice-2');
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(sent).toEqual([`🚫 <@${USER}> isn't in the voice channel with me.`]);
		expect(player!.skip).not.toHaveBeenCalled();
	});

	it('denies a non-DJ when the guild requires DJ', async () => {
		configure({ require_dj: true });
		setMusicConfig({ guild_id: guildId, dj_role_id: 'dj' });
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(sent).toEqual([`🚫 <@${USER}> needs the DJ role for that.`]);
		expect(logged()).toEqual([{ intent: 'skip', dispatched: 0 }]);
	});

	it('allows a DJ when the guild requires DJ', async () => {
		configure({ require_dj: true });
		setMusicConfig({ guild_id: guildId, dj_role_id: 'dj' });
		install(member({ roles: { cache: new Map([['dj', {}]]) } }));
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(player!.skip).toHaveBeenCalled();
	});
});

describe('dispatch assistant intents', () => {
	it('answers a non-DJ outside the bot channel: the music gates do not apply', async () => {
		configure({ require_dj: true });
		setMusicConfig({ guild_id: guildId, dj_role_id: 'dj' });
		vi.mocked(getMusicBotChannelId).mockReturnValue('voice-2');
		await dispatch(guildId, USER, intent('what time is it'), 'what time is it', TEXT_CHANNEL);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatch(/^✅ it's \d{1,2}:\d{2} [AP]M\.$/);
		expect(logged()).toEqual([{ intent: 'time', dispatched: 1 }]);
	});

	it('still refuses a speaker it cannot find in the server', async () => {
		configure();
		install(null);
		await dispatch(guildId, USER, intent('set a timer for 5 minutes'), 'set a timer for 5 minutes', TEXT_CHANNEL);
		expect(sent).toEqual([`🚫 <@${USER}> couldn't find you in this server.`]);
		expect(list(guildId, USER)).toEqual([]);
	});

	it('sets, reports and cancels a timer without touching the music', async () => {
		configure();
		await dispatch(guildId, USER, intent('set a timer for five minutes'), 'set a timer for five minutes', TEXT_CHANNEL);
		expect(list(guildId, USER)).toMatchObject([{ kind: 'timer', textChannelId: TEXT_CHANNEL, label: 'timer for 5 minutes' }]);
		await dispatch(guildId, USER, intent('how much time is left on my timer'), 'how much time is left on my timer', TEXT_CHANNEL);
		await dispatch(guildId, USER, intent('stop the timer'), 'stop the timer', TEXT_CHANNEL);
		expect(sent).toEqual([
			'✅ timer set for 5 minutes.',
			expect.stringMatching(/^✅ your timer for 5 minutes has \d minutes?( \d+ seconds?)? left\.$/),
			'✅ cancelled your timer.'
		]);
		expect(list(guildId, USER)).toEqual([]);
		expect(player!.skip).not.toHaveBeenCalled();
		cancel(guildId, USER);
	});

	describe('at 10 AM on Thursday, November 5 in Chicago', () => {
		beforeEach(() => {
			vi.useFakeTimers({ now: new Date('2026-11-05T16:00:00Z'), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
			vi.stubEnv('VOICE_TIMEZONE', 'America/Chicago');
		});

		afterEach(() => {
			cancel(guildId, USER);
			vi.unstubAllEnvs();
			vi.useRealTimers();
		});

		it('sets an alarm for the hour, minute, meridiem and day that were said', async () => {
			configure();
			await dispatch(guildId, USER, intent('set an alarm for 7:30 pm tomorrow'), 'set an alarm for 7:30 pm tomorrow', TEXT_CHANNEL);
			expect(sent).toEqual(['✅ alarm set for 7:30 PM tomorrow.']);
			expect(list(guildId, USER)).toMatchObject([{ kind: 'alarm', fireAt: Date.parse('2026-11-07T01:30:00Z') }]);
		});

		it('cancels only the kind that was named', async () => {
			configure();
			await dispatch(guildId, USER, intent('set a timer for five minutes'), 'set a timer for five minutes', TEXT_CHANNEL);
			await dispatch(guildId, USER, intent('set an alarm for 7 am'), 'set an alarm for 7 am', TEXT_CHANNEL);
			await dispatch(guildId, USER, intent('cancel my alarm'), 'cancel my alarm', TEXT_CHANNEL);
			expect(sent.at(-1)).toBe('✅ cancelled your alarm.');
			expect(list(guildId, USER)).toMatchObject([{ kind: 'timer' }]);
		});

		it('forecasts the place and day that were said', async () => {
			configure();
			vi.mocked(geocode).mockResolvedValue({
				name: 'Chicago',
				admin1: 'Illinois',
				country: 'United States',
				countryCode: 'US',
				latitude: 41.85,
				longitude: -87.65,
				timezone: 'America/Chicago'
			});
			vi.mocked(fetchWeather).mockResolvedValue({
				imperial: true,
				current: { temperature: 46.6, feelsLike: 41.2, code: 3, windSpeed: 9.4 },
				daily: [
					{ date: '2026-11-05', code: 3, high: 53, low: 45, precipitationChance: 26 },
					{ date: '2026-11-06', code: 61, high: 48, low: 37, precipitationChance: 1 }
				]
			});
			const said = "what's the weather in chicago tomorrow";
			await dispatch(guildId, USER, intent(said), said, TEXT_CHANNEL);
			expect(geocode).toHaveBeenCalledWith('chicago');
			expect(sent).toEqual(['✅ tomorrow in Chicago, Illinois: light rain, high 48, low 37 degrees Fahrenheit, 1 percent chance of rain.']);
		});
	});

	it('asks where when no place is said and there is no home location', async () => {
		configure();
		vi.stubEnv('VOICE_HOME_LOCATION', '');
		await dispatch(guildId, USER, intent("what's the weather"), "what's the weather", TEXT_CHANNEL);
		vi.unstubAllEnvs();
		expect(sent).toEqual(["⚠️ where? try 'weather in Chicago'."]);
		expect(logged()).toEqual([{ intent: 'weather_current', dispatched: 0 }]);
	});
});

describe('dispatch acknowledgements', () => {
	it('names what was heard on a low-confidence match', async () => {
		configure();
		const parsed = intent('skp');
		await dispatch(guildId, USER, parsed, 'skp', TEXT_CHANNEL);
		expect(player!.skip).toHaveBeenCalled();
		expect(sent).toEqual(['✅ skipped. _(heard: "skp")_']);
		expect(logged()).toEqual([{ intent: 'skip', dispatched: 1 }]);
	});

	it('acks without the heard suffix at high confidence', async () => {
		configure();
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(sent).toEqual(['✅ skipped.']);
	});

	it('reports a failed action and logs it as not dispatched', async () => {
		configure();
		player = undefined;
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(sent).toEqual(["⚠️ nothing's playing right now."]);
		expect(logged()).toEqual([{ intent: 'skip', dispatched: 0 }]);
	});

	it('sends nothing when ack_mode is none', async () => {
		configure({ ack_mode: 'none' });
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(player!.skip).toHaveBeenCalled();
		expect(sent).toEqual([]);
	});

	it('falls back to text when speech synthesis fails', async () => {
		configure({ ack_mode: 'tts' });
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(synthesize).toHaveBeenCalledWith('skipped.');
		expect(sent).toEqual(['✅ skipped.']);
	});

	it('speaks instead of texting when synthesis and playback succeed', async () => {
		configure({ ack_mode: 'tts' });
		const wav = new Uint8Array([1]);
		vi.mocked(synthesize).mockResolvedValue(wav);
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(playSpeech).toHaveBeenCalledWith(guildId, wav);
		expect(sent).toEqual([]);
	});

	it('does nothing visible without a text channel', async () => {
		configure();
		await dispatch(guildId, USER, intent('skip'), 'skip', null);
		expect(player!.skip).toHaveBeenCalled();
		expect(sent).toEqual([]);
	});
});

describe('dispatch intents', () => {
	it('steps the volume relatively and clamps it', async () => {
		configure();
		await dispatch(guildId, USER, intent('turn it up'), 'turn it up', TEXT_CHANNEL);
		expect(player!.setVolume).toHaveBeenLastCalledWith(60);
		player!.volume = 5;
		await dispatch(guildId, USER, intent('quieter'), 'quieter', TEXT_CHANNEL);
		expect(player!.setVolume).toHaveBeenLastCalledWith(1);
		player!.volume = 95;
		await dispatch(guildId, USER, intent('louder'), 'louder', TEXT_CHANNEL);
		expect(player!.setVolume).toHaveBeenLastCalledWith(100);
	});

	it('sets an absolute volume from the slot', async () => {
		configure();
		await dispatch(guildId, USER, intent('volume forty five'), 'volume forty five', TEXT_CHANNEL);
		expect(player!.setVolume).toHaveBeenCalledWith(45);
		expect(sent).toEqual(["✅ volume's at 45 now."]);
	});

	it('asks a speaker outside voice to join before playing', async () => {
		configure();
		install(member({ voice: { channelId: null, channel: null } }));
		await dispatch(guildId, USER, intent('play something'), 'play something', TEXT_CHANNEL);
		expect(sent).toEqual(['⚠️ get in a voice channel first.']);
	});

	it('turns a thrown action into an internal error', async () => {
		configure();
		player!.skip.mockImplementation(() => {
			throw new Error('boom');
		});
		await dispatch(guildId, USER, intent('skip'), 'skip', TEXT_CHANNEL);
		expect(sent).toEqual(['⚠️ that blew up on my end, check the logs.']);
		expect(logged()).toEqual([{ intent: 'skip', dispatched: 0 }]);
	});
});

describe('reportUnknownCommand', () => {
	it('names what was heard', async () => {
		configure();
		await reportUnknownCommand(guildId, USER, 'Do a barrel roll!', TEXT_CHANNEL);
		expect(sent).toEqual([`❓ <@${USER}> I don't know that one — heard: "do a barrel roll"`]);
	});

	it('says it is listening when only the wake word was heard', async () => {
		configure();
		await reportUnknownCommand(guildId, USER, '...', TEXT_CHANNEL);
		expect(sent).toEqual([`❓ <@${USER}> I'm listening, but I didn't catch a command.`]);
	});

	it('stays quiet when ack_mode is none', async () => {
		configure({ ack_mode: 'none' });
		await reportUnknownCommand(guildId, USER, 'huh', TEXT_CHANNEL);
		expect(sent).toEqual([]);
	});
});
