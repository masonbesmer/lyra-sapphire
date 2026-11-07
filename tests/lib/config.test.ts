import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FOLLOW_DELAY_MS,
	DEFAULT_IDLE_TIMEOUT_MS,
	deleteCommandPermission,
	deleteWordTrigger,
	getCommandPermissions,
	getExcludedTriggerChannels,
	getMusicConfig,
	getVoiceAssistantConfig,
	getWordTriggers,
	isTriggerChannelExcluded,
	isVoiceFollowEnabled,
	isVoiceOptedOut,
	logVoiceCommand,
	setCommandPermission,
	setMusicConfig,
	setTriggerChannelExcluded,
	setVoiceAssistantConfig,
	setVoiceFollow,
	setVoiceOptOut,
	setWordTrigger
} from '../../src/lib/config';
import { db } from '../../src/lib/database';

describe('music config', () => {
	it('returns defaults for a guild without a row', () => {
		expect(getMusicConfig('music-default')).toEqual({
			guild_id: 'music-default',
			dj_role_id: null,
			default_volume: 25,
			announce_tracks: true,
			announce_channel_id: null,
			idle_timeout_ms: DEFAULT_IDLE_TIMEOUT_MS
		});
	});

	it('merges partial updates over the stored config', () => {
		setMusicConfig({ guild_id: 'music-merge', dj_role_id: 'r1', default_volume: 70 });
		setMusicConfig({ guild_id: 'music-merge', announce_tracks: false });
		expect(getMusicConfig('music-merge')).toMatchObject({ dj_role_id: 'r1', default_volume: 70, announce_tracks: false });
	});

	it('clears nullable fields on an explicit null', () => {
		setMusicConfig({ guild_id: 'music-null', dj_role_id: 'r1', announce_channel_id: 'c1' });
		setMusicConfig({ guild_id: 'music-null', dj_role_id: null });
		expect(getMusicConfig('music-null')).toMatchObject({ dj_role_id: null, announce_channel_id: 'c1' });
	});

	it('stores an idle timeout of 0', () => {
		setMusicConfig({ guild_id: 'music-idle', idle_timeout_ms: 0 });
		expect(getMusicConfig('music-idle').idle_timeout_ms).toBe(0);
	});
});

describe('voice assistant config', () => {
	it('returns opt-out defaults for a guild without a row', () => {
		expect(getVoiceAssistantConfig('va-default')).toEqual({
			guild_id: 'va-default',
			enabled: false,
			wake_word: 'hey_jarvis_v0.1',
			sensitivity: 0.5,
			require_dj: true,
			ack_mode: 'text',
			text_channel_id: null,
			silence_ms: 600,
			max_utterance_ms: 8000,
			follow_delay_ms: DEFAULT_FOLLOW_DELAY_MS,
			wake_chime: true
		});
	});

	it('merges partial updates and round-trips booleans', () => {
		setVoiceAssistantConfig({ guild_id: 'va-merge', enabled: true, ack_mode: 'tts', text_channel_id: 'c1' });
		setVoiceAssistantConfig({ guild_id: 'va-merge', wake_chime: false, require_dj: false });
		expect(getVoiceAssistantConfig('va-merge')).toMatchObject({
			enabled: true,
			ack_mode: 'tts',
			text_channel_id: 'c1',
			wake_chime: false,
			require_dj: false
		});
		setVoiceAssistantConfig({ guild_id: 'va-merge', text_channel_id: null });
		expect(getVoiceAssistantConfig('va-merge').text_channel_id).toBeNull();
	});
});

describe('voice opt-out and follow', () => {
	it('toggles opt-out idempotently', () => {
		expect(isVoiceOptedOut('vo', 'u1')).toBe(false);
		setVoiceOptOut('vo', 'u1', true);
		setVoiceOptOut('vo', 'u1', true);
		expect(isVoiceOptedOut('vo', 'u1')).toBe(true);
		expect(isVoiceOptedOut('vo-other', 'u1')).toBe(false);
		setVoiceOptOut('vo', 'u1', false);
		setVoiceOptOut('vo', 'u1', false);
		expect(isVoiceOptedOut('vo', 'u1')).toBe(false);
	});

	it('toggles follow idempotently', () => {
		expect(isVoiceFollowEnabled('vf', 'u1')).toBe(false);
		setVoiceFollow('vf', 'u1', true);
		setVoiceFollow('vf', 'u1', true);
		expect(isVoiceFollowEnabled('vf', 'u1')).toBe(true);
		setVoiceFollow('vf', 'u1', false);
		expect(isVoiceFollowEnabled('vf', 'u1')).toBe(false);
	});
});

describe('command permissions', () => {
	it('stores lower-cased command names and deletes case-insensitively', () => {
		setCommandPermission('cp', 'Play', 'r1');
		setCommandPermission('cp', 'ban', 'r2');
		setCommandPermission('cp', 'PLAY', 'r3');
		expect(getCommandPermissions('cp')).toEqual([
			{ command_name: 'ban', required_role_id: 'r2' },
			{ command_name: 'play', required_role_id: 'r3' }
		]);
		expect(deleteCommandPermission('cp', 'pLaY')).toBe(true);
		expect(deleteCommandPermission('cp', 'play')).toBe(false);
		expect(getCommandPermissions('cp')).toEqual([{ command_name: 'ban', required_role_id: 'r2' }]);
	});
});

describe('word triggers', () => {
	it('stores lower-cased keywords per guild', () => {
		setWordTrigger('wt-a', 'Hello', 'hi there');
		setWordTrigger('wt-a', 'bye', 'see ya');
		expect(getWordTriggers('wt-a')).toEqual([
			{ keyword: 'bye', response: 'see ya' },
			{ keyword: 'hello', response: 'hi there' }
		]);
		expect(getWordTriggers('wt-b')).toEqual([]);
	});

	it('deletes a trigger and reports whether it existed', () => {
		setWordTrigger('wt-del', 'gone', 'x');
		expect(deleteWordTrigger('wt-del', 'GONE')).toBe(true);
		expect(deleteWordTrigger('wt-del', 'gone')).toBe(false);
	});

	it('excludes and re-includes channels', () => {
		setTriggerChannelExcluded('wt-ex', 'c2', true);
		setTriggerChannelExcluded('wt-ex', 'c1', true);
		setTriggerChannelExcluded('wt-ex', 'c1', true);
		expect(getExcludedTriggerChannels('wt-ex')).toEqual(['c1', 'c2']);
		expect(isTriggerChannelExcluded('wt-ex', 'c1')).toBe(true);
		expect(isTriggerChannelExcluded('wt-other', 'c1')).toBe(false);
		setTriggerChannelExcluded('wt-ex', 'c1', false);
		expect(getExcludedTriggerChannels('wt-ex')).toEqual(['c2']);
	});
});

describe('logVoiceCommand', () => {
	it('writes a transcript row with nullable fields', () => {
		logVoiceCommand({ guildId: 'vl', userId: 'u1', transcript: 'skip', intent: 'skip', confidence: 0.95, dispatched: true });
		logVoiceCommand({ guildId: 'vl', userId: 'u1', transcript: 'mumble' });
		expect(
			db.prepare('SELECT transcript, intent, confidence, dispatched FROM voice_command_log WHERE guild_id = ? ORDER BY id').all('vl')
		).toEqual([
			{ transcript: 'skip', intent: 'skip', confidence: 0.95, dispatched: 1 },
			{ transcript: 'mumble', intent: null, confidence: null, dispatched: 0 }
		]);
	});
});
