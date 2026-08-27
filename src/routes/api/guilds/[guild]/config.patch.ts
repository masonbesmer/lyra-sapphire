import { ChannelType } from 'discord.js';
import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, readJsonBody, requireAdmin } from '../_helpers';
import { getMusicConfig, setMusicConfig } from '../../../../lib/config';
import { auditActor, recordConfigDiff } from '../../../../lib/audit';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;

		if (!requireAdmin(response, resolved.member)) return;

		const body =
			await readJsonBody<
				Partial<{ dj_role_id: string | null; default_volume: number; announce_tracks: boolean; announce_channel_id: string | null }>
			>(request);
		if (!body) return response.error(HttpCodes.BadRequest);

		const update: Partial<{
			dj_role_id: string | null;
			default_volume: number;
			announce_tracks: boolean;
			announce_channel_id: string | null;
		}> = {};

		if ('default_volume' in body) {
			const volume = body.default_volume;
			if (typeof volume !== 'number' || !Number.isInteger(volume) || volume < 1 || volume > 100) {
				return response.error(HttpCodes.BadRequest);
			}
			update.default_volume = volume;
		}

		if ('dj_role_id' in body) {
			const roleId = body.dj_role_id;
			if (roleId !== null) {
				if (typeof roleId !== 'string' || !resolved.guild.roles.cache.has(roleId)) {
					return response.error(HttpCodes.BadRequest);
				}
			}
			update.dj_role_id = roleId;
		}

		if ('announce_tracks' in body) {
			if (typeof body.announce_tracks !== 'boolean') {
				return response.error(HttpCodes.BadRequest);
			}
			update.announce_tracks = body.announce_tracks;
		}

		if ('announce_channel_id' in body) {
			const channelId = body.announce_channel_id;
			if (channelId !== null) {
				const channel = resolved.guild.channels.cache.get(channelId ?? '');
				if (typeof channelId !== 'string' || !channel || channel.type !== ChannelType.GuildText) {
					return response.error(HttpCodes.BadRequest);
				}
			}
			update.announce_channel_id = channelId;
		}

		const before = getMusicConfig(resolved.guild.id);
		setMusicConfig({ guild_id: resolved.guild.id, ...update });
		const after = getMusicConfig(resolved.guild.id);
		recordConfigDiff(resolved.guild.id, auditActor(resolved.member, 'dashboard'), 'music', before, after);
		return response.json(after);
	}
}
