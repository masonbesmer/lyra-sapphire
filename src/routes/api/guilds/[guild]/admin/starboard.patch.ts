import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { ChannelType } from 'discord.js';
import { resolveGuild, readJsonBody, requireAdmin } from '../../_helpers';
import {
	getStarboardConfig,
	setStarboardChannel,
	setStarboardEmoji,
	setStarboardEnabled,
	setStarboardSelfStar,
	setStarboardThreshold
} from '../../../../../lib/starboard';
import { auditActor, recordConfigDiff } from '../../../../../lib/audit';

type Body = Partial<{
	enabled: boolean;
	channel_id: string | null;
	threshold: number;
	emoji: string;
	self_star: boolean;
}>;

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const resolved = await resolveGuild(request, response, request.params.guild);
		if (!resolved) return;
		const { guild, member } = resolved;
		if (!requireAdmin(response, member)) return;

		const body = await readJsonBody<Body>(request);
		if (!body) return response.error(HttpCodes.BadRequest);

		// Every field is validated before any of them is written, so a bad field can't leave
		// the config half-updated - and the audit diff below sees the whole change or none of it.
		const apply: (() => void)[] = [];

		if ('enabled' in body) {
			if (typeof body.enabled !== 'boolean') return response.error(HttpCodes.BadRequest, 'enabled must be true or false.');
			const enabled = body.enabled;
			apply.push(() => setStarboardEnabled(guild.id, enabled));
		}

		if ('channel_id' in body) {
			const channelId = body.channel_id;
			if (channelId !== null) {
				const channel = guild.channels.cache.get(String(channelId));
				if (!channel || channel.type !== ChannelType.GuildText) {
					return response.error(HttpCodes.BadRequest, 'That needs to be a text channel in this server.');
				}
			}
			apply.push(() => setStarboardChannel(guild.id, channelId ?? null));
		}

		if ('threshold' in body) {
			const threshold = body.threshold;
			if (typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 1 || threshold > 50) {
				return response.error(HttpCodes.BadRequest, 'Threshold must be a whole number between 1 and 50.');
			}
			apply.push(() => setStarboardThreshold(guild.id, threshold));
		}

		if ('emoji' in body) {
			const emoji = body.emoji;
			if (typeof emoji !== 'string' || emoji.trim().length === 0 || emoji.length > 64) {
				return response.error(HttpCodes.BadRequest, 'Give me a single emoji.');
			}
			apply.push(() => setStarboardEmoji(guild.id, emoji.trim()));
		}

		if ('self_star' in body) {
			if (typeof body.self_star !== 'boolean') return response.error(HttpCodes.BadRequest, 'self_star must be true or false.');
			const selfStar = body.self_star;
			apply.push(() => setStarboardSelfStar(guild.id, selfStar));
		}

		const before = getStarboardConfig(guild.id);
		for (const write of apply) write();
		const after = getStarboardConfig(guild.id);
		recordConfigDiff(guild.id, auditActor(member, 'dashboard'), 'starboard', before, after);
		return response.json(after);
	}
}
