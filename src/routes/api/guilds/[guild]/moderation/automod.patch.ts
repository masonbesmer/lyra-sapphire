import { HttpCodes, Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { PermissionFlagsBits } from 'discord.js';
import { readJsonBody } from '../../_helpers';
import { idChecks, resolveModerator, resyncNative, sendFailure } from '../../_moderation';
import { auditActor, recordConfigChange } from '../../../../../lib/audit';
import { getAutomodSettings, getRule, isAutomodRule, saveAutomodSettings, saveRule } from '../../../../../lib/automod';
import { describeSyncReport, syncNativeRules } from '../../../../../lib/automodNative';
import { applyRulePatch, auditAutomodRule, idList, type RulePatch } from '../../../../../lib/modDashboard';

interface Body extends RulePatch {
	/** One filter to change. Omit to change the AutoMod-wide settings in `global`. */
	rule?: unknown;
	global?: { exempt_roles?: unknown; exempt_channels?: unknown; native_sync?: unknown };
}

/** The `/permissions` gates a change would pass through as a slash command. */
function gatePaths(body: Body | null): string[] {
	if (!body) return [];
	const paths = new Set<string>();
	if (body.global?.native_sync !== undefined) paths.add('automod native');
	if (body.global?.exempt_roles !== undefined || body.global?.exempt_channels !== undefined) paths.add('automod exempt add');
	if (body.exempt_roles !== undefined || body.exempt_channels !== undefined) paths.add('automod exempt add');
	if (body.list !== undefined) paths.add('automod list add');
	const configures = ['enabled', 'action', 'duration_ms', 'limit', 'window_ms', 'mode'] as const;
	if (configures.some((key) => body[key] !== undefined)) paths.add('automod configure');
	return [...paths];
}

/** One AutoMod filter, or the AutoMod-wide exemptions and native sync, with the same rules as /automod. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const body = await readJsonBody<Body>(request);
		const resolved = await resolveModerator(request, response, 'automod', gatePaths(body));
		if (!resolved) return;
		const { guild, member } = resolved;
		if (!body) return response.error(HttpCodes.BadRequest);
		const actor = auditActor(member, 'dashboard');
		const checks = idChecks(guild);

		try {
			if (body.global) {
				const before = getAutomodSettings(guild.id);
				const after = { ...before };
				const { exempt_roles, exempt_channels, native_sync } = body.global;
				if (exempt_roles !== undefined) {
					const result = idList(exempt_roles, checks.isRole, 'exempt roles');
					if ('error' in result) return response.error(HttpCodes.BadRequest, result.error);
					after.exemptRoles = result.ids;
				}
				if (exempt_channels !== undefined) {
					const result = idList(exempt_channels, checks.isChannel, 'exempt channels');
					if ('error' in result) return response.error(HttpCodes.BadRequest, result.error);
					after.exemptChannels = result.ids;
				}
				if (native_sync !== undefined) {
					if (typeof native_sync !== 'boolean') return response.error(HttpCodes.BadRequest, 'native_sync must be true or false.');
					const me = guild.members.me ?? (await guild.members.fetchMe());
					if (native_sync !== before.nativeSync && !me.permissions.has(PermissionFlagsBits.ManageGuild)) {
						return response.error(HttpCodes.BadRequest, 'I need the Manage Server permission to manage native AutoMod rules.');
					}
					after.nativeSync = native_sync;
				}
				saveAutomodSettings(guild.id, after);
				recordConfigChange(guild.id, actor, 'moderation', 'automod.exempt_roles', before.exemptRoles.join(','), after.exemptRoles.join(','));
				recordConfigChange(
					guild.id,
					actor,
					'moderation',
					'automod.exempt_channels',
					before.exemptChannels.join(','),
					after.exemptChannels.join(',')
				);
				recordConfigChange(guild.id, actor, 'moderation', 'automod.native_sync', before.nativeSync, after.nativeSync);

				let warning: string | null;
				if (after.nativeSync !== before.nativeSync) {
					const report = await syncNativeRules(guild, {
						remove: !after.nativeSync,
						reason: `${member.user.username}: dashboard native sync ${after.nativeSync ? 'on' : 'off'}`
					});
					warning = report.failed.length || report.skipped.length ? `Native AutoMod: ${describeSyncReport(report)}` : null;
				} else {
					warning = await resyncNative(guild);
				}
				return response.json({ settings: getAutomodSettings(guild.id), warning });
			}

			if (typeof body.rule !== 'string' || !isAutomodRule(body.rule)) return response.error(HttpCodes.BadRequest, 'Pick an AutoMod filter.');
			const before = getRule(guild.id, body.rule);
			const result = applyRulePatch(before, body, checks);
			if ('error' in result) return response.error(HttpCodes.BadRequest, result.error.charAt(0).toUpperCase() + result.error.slice(1));
			saveRule(guild.id, result.config);
			const after = getRule(guild.id, body.rule);
			auditAutomodRule(guild.id, actor, before, after);
			const emptyAllowlist =
				after.enabled && after.rule === 'links' && after.settings.mode === 'allow' && !(after.settings.domains ?? []).length;
			const warning = [emptyAllowlist ? 'The links allowlist is empty, so every link is blocked.' : null, await resyncNative(guild)]
				.filter(Boolean)
				.join(' ');
			return response.json({ rule: after, warning: warning || null });
		} catch (error) {
			return sendFailure(response, error);
		}
	}
}
