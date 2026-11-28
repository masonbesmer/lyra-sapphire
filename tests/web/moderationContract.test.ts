import { describe, expectTypeOf, it } from 'vitest';
import type { AntiRaidConfig } from '../../src/lib/antiRaid';
import type { AutomodSettings, RuleConfig } from '../../src/lib/automod';
import type { ModCase } from '../../src/lib/moderation';
import type { panelView } from '../../src/routes/api/guilds/_moderation';
import type {
	AntiRaidConfig as WebAntiRaid,
	AutomodRule as WebRule,
	AutomodSettings as WebSettings,
	ModCase as WebCase,
	RolePanel as WebPanel
} from '../../web/src/lib/types.js' with { 'resolution-mode': 'import' };

// The dashboard keeps its own copies of the moderation response types it reads from the server.
describe('dashboard moderation contract', () => {
	it('reads only fields the server sends', () => {
		expectTypeOf<ModCase>().toExtend<WebCase>();
		expectTypeOf<RuleConfig>().toExtend<WebRule>();
		expectTypeOf<AutomodSettings>().toExtend<WebSettings>();
		expectTypeOf<AntiRaidConfig>().toExtend<WebAntiRaid>();
		expectTypeOf<ReturnType<typeof panelView>>().toExtend<WebPanel>();
	});
});
