import { describe, expect, it } from 'vitest';
import { stripHallucinations } from '../../../src/lib/voice/sttClient';

describe('stripHallucinations', () => {
	it('removes bracketed Whisper non-speech tokens', () => {
		expect(stripHallucinations('[BLANK_AUDIO]')).toBe('');
		expect(stripHallucinations('(music) skip *applause*')).toBe('skip');
		expect(stripHallucinations('[ Silence ] pause [inaudible]')).toBe('pause');
	});

	it('keeps the bare word "music" inside real speech', () => {
		expect(stripHallucinations('play some music please')).toBe('play some music please');
	});
});
