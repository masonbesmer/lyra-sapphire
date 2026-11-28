import { HttpCodes, Route, type ApiRequest, type ApiResponse } from '@sapphire/plugin-api';
import { readJsonBody } from '../../_helpers';
import { resolveModerator, sendFailure } from '../../_moderation';
import { auditActor, recordConfigChange } from '../../../../../lib/audit';
import {
	LOG_CHANNEL_PERMISSIONS,
	addLogIgnore,
	getLogIgnores,
	getLogRoutes,
	isLogEvent,
	removeLogIgnore,
	setLogRoutes,
	type LogEvent,
	type LogIgnoreType
} from '../../../../../lib/eventLog';
import { primeInvites } from '../../../../../lib/eventLogPost';

interface Body {
	/** Event → channel ID, or null to stop logging it. Events left out are untouched. */
	routes?: Record<string, unknown>;
	ignore?: { type?: unknown; id?: unknown; ignored?: unknown };
}

/** Event-log routing and ignore lists, with the same checks as /logconfig. */
export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const body = await readJsonBody<Body>(request);
		const paths = [body?.routes ? 'logconfig channel' : null, body?.ignore ? 'logconfig ignore' : null].filter(
			(path): path is string => path !== null
		);
		const resolved = await resolveModerator(request, response, 'logging', paths);
		if (!resolved) return;
		const { guild, member } = resolved;
		if (!body || (!body.routes && !body.ignore)) return response.error(HttpCodes.BadRequest, 'Nothing to change.');

		try {
			const actor = auditActor(member, 'dashboard');

			if (body.routes) {
				if (typeof body.routes !== 'object' || Array.isArray(body.routes))
					return response.error(HttpCodes.BadRequest, 'routes must be an object.');
				// Validate every event and channel before writing any, so a bad one can't leave routing half-applied.
				const byChannel = new Map<string | null, LogEvent[]>();
				const me = guild.members.me ?? (await guild.members.fetchMe());
				for (const [event, channelId] of Object.entries(body.routes)) {
					if (!isLogEvent(event)) return response.error(HttpCodes.BadRequest, `"${event}" isn't a log event.`);
					if (channelId !== null) {
						const channel = typeof channelId === 'string' ? guild.channels.cache.get(channelId) : undefined;
						if (!channel?.isSendable() || !channel.permissionsFor(me).has(LOG_CHANNEL_PERMISSIONS)) {
							return response.error(
								HttpCodes.BadRequest,
								'I need View Channel, Send Messages, Embed Links and Attach Files in every log channel.'
							);
						}
					}
					const key = (channelId as string | null) ?? null;
					byChannel.set(key, [...(byChannel.get(key) ?? []), event]);
				}
				const before = getLogRoutes(guild.id);
				for (const [channelId, events] of byChannel) {
					setLogRoutes(guild.id, events, channelId);
					for (const event of events) recordConfigChange(guild.id, actor, 'moderation', `log.${event}`, before[event] ?? null, channelId);
				}
				if ([...byChannel.values()].some((events) => events.includes('member_join'))) await primeInvites(guild);
			}

			if (body.ignore) {
				const { type, id, ignored } = body.ignore;
				if (type !== 'channel' && type !== 'user') return response.error(HttpCodes.BadRequest, 'ignore.type must be channel or user.');
				if (typeof id !== 'string' || !/^\d{16,20}$/.test(id)) return response.error(HttpCodes.BadRequest, 'ignore.id must be an ID.');
				if (typeof ignored !== 'boolean') return response.error(HttpCodes.BadRequest, 'ignore.ignored must be true or false.');
				if (type === 'channel' && ignored && !guild.channels.cache.has(id))
					return response.error(HttpCodes.BadRequest, "That channel isn't in this server.");
				const ignoreType: LogIgnoreType = type;
				const before = getLogIgnores(guild.id)[ignoreType];
				if (ignored) addLogIgnore(guild.id, ignoreType, id);
				else removeLogIgnore(guild.id, ignoreType, id);
				recordConfigChange(
					guild.id,
					actor,
					'moderation',
					`log_ignore.${ignoreType}`,
					before.join(','),
					getLogIgnores(guild.id)[ignoreType].join(',')
				);
			}

			return response.json({ routes: getLogRoutes(guild.id), ignores: getLogIgnores(guild.id) });
		} catch (error) {
			return sendFailure(response, error);
		}
	}
}
