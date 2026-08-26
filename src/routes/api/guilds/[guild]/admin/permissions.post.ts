import { Route, type ApiRequest, type ApiResponse, HttpCodes } from '@sapphire/plugin-api';
import { container } from '@sapphire/framework';
import { resolveGuild, readJsonBody, requireAdmin } from '../../_helpers';
import { deleteCommandPermission, getCommandPermissions, setCommandPermission } from '../../../../../lib/config';

interface Body {
	action: 'set' | 'remove';
	command_name: string;
	required_role_id?: string;
}

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
		if (body.action !== 'set' && body.action !== 'remove') return response.error(HttpCodes.BadRequest);
		if (typeof body.command_name !== 'string' || body.command_name.trim().length === 0) {
			return response.error(HttpCodes.BadRequest, 'Pick a command.');
		}

		const commandName = body.command_name.trim().toLowerCase();

		if (body.action === 'remove') {
			deleteCommandPermission(guild.id, commandName);
			return response.json(getCommandPermissions(guild.id));
		}

		// Guarding against typos here matters: a requirement on a command that does not exist
		// is invisible in the UI's command list but still sits in the table.
		if (!container.stores.get('commands').has(commandName)) {
			return response.error(HttpCodes.BadRequest, 'No command by that name.');
		}
		if (typeof body.required_role_id !== 'string' || !guild.roles.cache.has(body.required_role_id)) {
			return response.error(HttpCodes.BadRequest, 'Pick a role that exists in this server.');
		}

		setCommandPermission(guild.id, commandName, body.required_role_id);
		return response.json(getCommandPermissions(guild.id));
	}
}
