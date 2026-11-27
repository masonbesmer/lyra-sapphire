/**
 * Opt-in privileged gateway intents. Requesting one that isn't switched on in the Discord
 * Developer Portal makes the login fail ("Used disallowed intents"), so each is behind an env flag.
 */

const TRUE = /^(1|true|yes|on)$/i;

/** Server Members intent (guildMemberAdd and friends): `DISCORD_MEMBERS_INTENT=true`. */
export function membersIntentEnabled(env: { DISCORD_MEMBERS_INTENT?: string } = process.env): boolean {
	return TRUE.test(env.DISCORD_MEMBERS_INTENT?.trim() ?? '');
}
