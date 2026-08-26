import { ChannelType } from 'discord.js';
import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { resolveGuild, readJsonBody } from '../_helpers';
import { getMusicConfig, setMusicConfig } from '../../../../lib/config';

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const guildId = request.params.guild;
		const resolved = await resolveGuild(request, response, guildId);
		if (!resolved) return;

		// Only guild admins can update config
		if (!resolved.member.permissions.has('ManageGuild')) {
			return response.error(HttpCodes.Forbidden);
		}

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

		setMusicConfig({ guild_id: guildId, ...update });
		return response.json(getMusicConfig(guildId));
	}
}
