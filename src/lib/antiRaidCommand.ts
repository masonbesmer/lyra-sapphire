import { JOIN_ACTIONS, formatJoinAction, isJoinAction, isRaidActive, type AntiRaidConfig, type AntiRaidSettings } from './antiRaid';
import { ModError, snowflakeFrom } from './modActions';
import { usage } from './modCommand';
import { formatDuration, parseDuration } from './moderation';

/** Parsing and display for /antiraid, kept out of the command file so it can be tested on its own. */

export const ANTIRAID_USAGE =
	'`%antiraid view` | `%antiraid end` | `%antiraid set <key> <value> [<key> <value> …]` | `%antiraid verification #channel [@role] [button|captcha]`\n' +
	'keys: enabled, join_threshold, join_window, lockdown, raid_action, raid_duration, alert_channel, alert_role, min_account_age, account_age_action, default_avatar_action, quarantine_role, quarantine_on_join (use `clear` to unset a channel/role, `off` for min_account_age)';

export const CLEARABLE = ['alert_channel', 'alert_role', 'quarantine_role', 'verify_role'] as const;
export const CLEAR_COLUMN: Record<(typeof CLEARABLE)[number], keyof AntiRaidSettings> = {
	alert_channel: 'alert_channel_id',
	alert_role: 'alert_role_id',
	quarantine_role: 'quarantine_role_id',
	verify_role: 'verify_role_id'
};

export function duration(text: string, label: string): number {
	const ms = parseDuration(text);
	if (ms === null) throw new ModError(`"${text}" isn't a duration I understand for ${label}. try \`10s\`, \`15m\` or \`7d\`.`);
	return ms;
}

export function bool(text: string, label: string): boolean {
	if (/^(on|true|yes|1)$/i.test(text)) return true;
	if (/^(off|false|no|0)$/i.test(text)) return false;
	throw new ModError(`${label} takes on or off.`);
}

export function joinAction(text: string, label: string) {
	const value = text.toLowerCase();
	if (!isJoinAction(value)) throw new ModError(`${label} is one of: ${JOIN_ACTIONS.join(', ')}.`);
	return value;
}

/** `%antiraid set key value …` → settings. Exported for tests. */
export function parseSetPairs(words: string[]): AntiRaidSettings {
	if (!words.length || words.length % 2 !== 0) usage(ANTIRAID_USAGE);
	const settings: AntiRaidSettings = {};
	for (let i = 0; i < words.length; i += 2) {
		const key = words[i].toLowerCase();
		const value = words[i + 1];
		const id = () => {
			if (value.toLowerCase() === 'clear') return null;
			const snowflake = snowflakeFrom(value);
			if (!snowflake) throw new ModError(`${key} takes a mention, an ID or \`clear\`.`);
			return snowflake;
		};
		switch (key) {
			case 'enabled':
				settings.enabled = bool(value, key);
				break;
			case 'join_threshold':
				settings.join_threshold = Number.parseInt(value, 10);
				if (!Number.isFinite(settings.join_threshold)) throw new ModError('join_threshold takes a number.');
				break;
			case 'join_window':
				settings.join_window_ms = duration(value, key);
				break;
			case 'lockdown':
				settings.raid_lockdown = bool(value, key);
				break;
			case 'raid_action':
				settings.raid_join_action = joinAction(value, key);
				break;
			case 'raid_duration':
				settings.raid_duration_ms = duration(value, key);
				break;
			case 'alert_channel':
				settings.alert_channel_id = id();
				break;
			case 'alert_role':
				settings.alert_role_id = id();
				break;
			case 'min_account_age':
				settings.min_account_age_ms = /^(off|0)$/i.test(value) ? 0 : duration(value, key);
				break;
			case 'account_age_action':
				settings.account_age_action = joinAction(value, key);
				break;
			case 'default_avatar_action':
				settings.default_avatar_action = joinAction(value, key);
				break;
			case 'quarantine_role':
				settings.quarantine_role_id = id();
				break;
			case 'quarantine_on_join':
				settings.quarantine_on_join = bool(value, key);
				break;
			default:
				throw new ModError(`I don't know the setting "${key}".`);
		}
	}
	return settings;
}

export function describeAntiRaid(config: AntiRaidConfig): string {
	const channel = (id: string | null) => (id ? `<#${id}>` : 'mod-log channel');
	const role = (id: string | null) => (id ? `<@&${id}>` : 'none');
	const lines = [
		`**Anti-raid:** ${config.enabled ? 'on' : 'off'}${isRaidActive(config) ? ` · 🚨 **raid mode until <t:${Math.floor(new Date(config.raid_until!).getTime() / 1000)}:t>**` : ''}`,
		`raid trigger: ${config.join_threshold} joins in ${formatDuration(config.join_window_ms)} → ${config.raid_lockdown ? 'lock the server' : 'alert only'} for ${formatDuration(config.raid_duration_ms)}, new members ${formatJoinAction(config.raid_join_action)}`,
		`min account age: ${config.min_account_age_ms ? `${formatDuration(config.min_account_age_ms)} (else ${formatJoinAction(config.account_age_action)})` : 'off'}`,
		`no profile picture: ${config.default_avatar_action === 'none' ? 'allowed' : formatJoinAction(config.default_avatar_action)}`,
		`quarantine role: ${role(config.quarantine_role_id)}${config.quarantine_on_join ? ' (every new member until verified)' : ''}`,
		`alerts: ${channel(config.alert_channel_id)}${config.alert_role_id ? `, pinging <@&${config.alert_role_id}>` : ''}`,
		`verification: ${config.verify_mode}, grants ${role(config.verify_role_id)}`
	];
	return lines.join('\n');
}
