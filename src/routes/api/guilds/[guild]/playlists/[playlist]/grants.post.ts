import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import type { Guild, User } from 'discord.js';
import { readJsonBody } from '../../../_helpers';
import { loadPlaylist, serializeGrant } from '../../../_playlists';
import { upsertGrant } from '../../../../../../lib/playlists';

interface Body {
	user?: unknown;
	create?: unknown;
	read?: unknown;
	update?: unknown;
	delete?: unknown;
}

const NO_SUCH_USER = 'No one by that name in this server - paste their user ID instead.';

/** A user ID resolves anywhere; a name only among this guild's members, and only when exactly one matches. */
async function resolveGrantee(guild: Guild, input: string): Promise<User | null> {
	if (/^\d{17,20}$/.test(input)) return container.client.users.fetch(input).catch(() => null);

	const query = input.replace(/^@/, '').toLowerCase();
	const members = await guild.members.search({ query, limit: 10 }).catch(() => null);
	const matches = [...(members?.values() ?? [])].filter((member) =>
		[member.user.username, member.user.globalName, member.displayName].some((name) => name?.toLowerCase() === query)
	);
	return matches.length === 1 ? matches[0].user : null;
}

export class UserRoute extends Route {
	public constructor(context: Route.LoaderContext, options: Route.Options) {
		super(context, options);
	}

	public override async run(request: ApiRequest, response: ApiResponse) {
		const loaded = await loadPlaylist(request, response, 'manage');
		if (!loaded) return;
		const { guild, member, playlist } = loaded;

		const body = await readJsonBody<Body>(request);
		const input = typeof body?.user === 'string' ? body.user.trim() : '';
		if (!input) return response.error(HttpCodes.BadRequest, 'Who should get access?');

		const flags = { create: body?.create === true, read: body?.read === true, update: body?.update === true, delete: body?.delete === true };
		if (!flags.create && !flags.read && !flags.update && !flags.delete)
			return response.error(HttpCodes.BadRequest, 'Pick at least one permission.');

		const grantee = await resolveGrantee(guild, input);
		if (!grantee) return response.error(HttpCodes.NotFound, NO_SUCH_USER);
		if (grantee.id === playlist.ownerId) return response.error(HttpCodes.BadRequest, 'You already own this playlist.');
		if (grantee.bot) return response.error(HttpCodes.BadRequest, "Bots can't be given access to playlists.");

		const grant = upsertGrant(playlist.id, grantee.id, flags, member.id);
		return response.json({ ok: true, grant: await serializeGrant(grant) });
	}
}
