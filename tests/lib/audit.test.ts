import { describe, expect, it } from 'vitest';
import {
	auditActor,
	auditConfigMutation,
	auditStarboardBlacklist,
	auditTriggerExclusion,
	getAuditSections,
	getConfigAudit,
	recordConfigChange,
	recordConfigDiff,
	type AuditActor
} from '../../src/lib/audit';
import { setMusicConfig, setTriggerChannelExcluded } from '../../src/lib/config';
import { addToStarboardBlacklist, removeFromStarboardBlacklist } from '../../src/lib/starboard';

const ACTOR: AuditActor = { id: 'u1', name: 'alice', source: 'dashboard' };

function changes(guildId: string) {
	return getConfigAudit(guildId, { limit: 100 })
		.reverse()
		.map((row) => [row.section, row.setting, row.old_value, row.new_value]);
}

describe('auditActor', () => {
	it('uses the username, not the display name', () => {
		const member = { id: 'u1', displayName: 'Nick', user: { username: 'alice' } } as never;
		expect(auditActor(member, 'discord')).toEqual({ id: 'u1', name: 'alice', source: 'discord' });
	});
});

describe('recordConfigChange', () => {
	it('drops no-op writes', () => {
		recordConfigChange('au-noop', ACTOR, 'music', 'default_volume', 50, 50);
		recordConfigChange('au-noop', ACTOR, 'music', 'dj_role_id', null, undefined);
		expect(getConfigAudit('au-noop')).toEqual([]);
	});

	it('serialises values into text, keeping null distinct', () => {
		const guildId = 'au-serialise';
		recordConfigChange(guildId, ACTOR, 'music', 'dj_role_id', null, 'r1');
		recordConfigChange(guildId, ACTOR, 'music', 'default_volume', 25, 70);
		recordConfigChange(guildId, ACTOR, 'music', 'announce_tracks', true, false);
		recordConfigChange(guildId, ACTOR, 'voice', 'gains', [0], { a: 1 });
		expect(changes(guildId)).toEqual([
			['music', 'dj_role_id', null, 'r1'],
			['music', 'default_volume', '25', '70'],
			['music', 'announce_tracks', 'true', 'false'],
			['voice', 'gains', '[0]', '{"a":1}']
		]);
		expect(getConfigAudit(guildId)[0]).toMatchObject({ actor_id: 'u1', actor_name: 'alice', source: 'dashboard', guild_id: guildId });
	});
});

describe('recordConfigDiff', () => {
	it('records only moved fields and skips guild_id', () => {
		recordConfigDiff('au-diff', ACTOR, 'starboard', { guild_id: 'a', threshold: 3, emoji: '⭐' }, { guild_id: 'b', threshold: 5, emoji: '⭐' });
		expect(changes('au-diff')).toEqual([['starboard', 'threshold', '3', '5']]);
	});
});

describe('auditConfigMutation', () => {
	it('audits the fields a mutation changed', () => {
		const guildId = 'au-mutation';
		auditConfigMutation('music', guildId, ACTOR, () => setMusicConfig({ guild_id: guildId, default_volume: 80 }));
		auditConfigMutation('music', guildId, ACTOR, () => setMusicConfig({ guild_id: guildId, default_volume: 80 }));
		expect(changes(guildId)).toEqual([['music', 'default_volume', '25', '80']]);
	});
});

describe('auditStarboardBlacklist', () => {
	it('logs additions and removals once each', () => {
		const guildId = 'au-blacklist';
		const add = () => addToStarboardBlacklist(guildId, 'c1', 'channel');
		auditStarboardBlacklist(guildId, ACTOR, 'c1', 'channel', add);
		auditStarboardBlacklist(guildId, ACTOR, 'c1', 'channel', add);
		auditStarboardBlacklist(guildId, ACTOR, 'c1', 'channel', () => removeFromStarboardBlacklist(guildId, 'c1', 'channel'));
		expect(changes(guildId)).toEqual([
			['starboard_blacklist', 'channel:c1', null, 'blacklisted'],
			['starboard_blacklist', 'channel:c1', 'blacklisted', null]
		]);
	});
});

describe('auditTriggerExclusion', () => {
	it('logs exclusions once and ignores redundant ones', () => {
		const guildId = 'au-exclude';
		const exclude = () => setTriggerChannelExcluded(guildId, 'c1', true);
		auditTriggerExclusion(guildId, ACTOR, 'c1', exclude);
		auditTriggerExclusion(guildId, ACTOR, 'c1', exclude);
		auditTriggerExclusion(guildId, ACTOR, 'c1', () => setTriggerChannelExcluded(guildId, 'c1', false));
		expect(changes(guildId)).toEqual([
			['triggers', 'exclude:c1', null, 'excluded'],
			['triggers', 'exclude:c1', 'excluded', null]
		]);
	});
});

describe('getConfigAudit', () => {
	const guildId = 'au-query';
	for (let i = 1; i <= 30; i++) recordConfigChange(guildId, ACTOR, i % 2 ? 'music' : 'voice', `s${i}`, null, i);

	it('returns newest first with a default limit of 25', () => {
		const rows = getConfigAudit(guildId);
		expect(rows).toHaveLength(25);
		expect(rows[0].setting).toBe('s30');
	});

	it('applies offset and clamps the limit to 1..100', () => {
		expect(getConfigAudit(guildId, { limit: 2, offset: 1 }).map((row) => row.setting)).toEqual(['s29', 's28']);
		expect(getConfigAudit(guildId, { limit: 0 })).toHaveLength(1);
		expect(getConfigAudit(guildId, { limit: 1000 })).toHaveLength(30);
		expect(getConfigAudit(guildId, { limit: 1, offset: -5 })[0].setting).toBe('s30');
	});

	it('filters by section', () => {
		const rows = getConfigAudit(guildId, { section: 'voice', limit: 100 });
		expect(rows).toHaveLength(15);
		expect(rows.every((row) => row.section === 'voice')).toBe(true);
	});

	it('lists the distinct sections present', () => {
		expect(getAuditSections(guildId)).toEqual(['music', 'voice']);
		expect(getAuditSections('au-empty')).toEqual([]);
	});
});
