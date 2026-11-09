# Lyra Bot Permissions System

Server administrators can require a Discord role for a whole command or for a single subcommand.

## How it Works

- **Default behaviour**: with no gate set, a command uses only its built-in permissions.
- **Gates**: a gate is a command path plus a role. The path is a command (`keyword`), a subcommand
  (`keyword add`), a subcommand group (`starboard blacklist`) or an entry in a group (`starboard blacklist add`).
- **Gates stack**: every gate on the invoked path applies. If `keyword` needs @A and `keyword add` needs @B,
  `/keyword add` needs both @A and @B, while `/keyword edit` needs only @A.
- **Everywhere**: gates are enforced by the global `RolePermission` precondition for slash commands, context
  menu commands and prefix (message) commands. Commands don't opt in; every command and subcommand can be gated.
- **Management**: `/permissions` and the dashboard's "Command permissions" card. `/permissions` itself is
  Administrator-only and can't be gated.
- Gates do nothing in DMs.

## Usage

```bash
# Require a role for a whole command
/permissions set command:keyword role:@Moderators

# Require a role for one subcommand (stacks with any gate on keyword)
/permissions set command:keyword add role:@Editors

# Remove a gate
/permissions remove command:keyword add

# List every gate in this server
/permissions list

# Show every gate that applies to a path
/permissions check command:keyword add
```

The `command` option autocompletes. `set` only accepts paths that exist; `remove` also accepts stale paths, so a
gate left behind by a removed command can still be cleared.

## Database Schema

Gates live in the `command_permissions` table. `command_name` holds the lowercase, space-separated path.

```sql
CREATE TABLE command_permissions (
    guild_id TEXT NOT NULL,
    command_name TEXT NOT NULL,
    required_role_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, command_name)
);
```

## Examples

1. **Restrict music commands to DJs**:

    ```
    /permissions set command:play role:@DJ
    /permissions set command:skip role:@DJ
    ```

2. **Let anyone with @Members use keywords, but only @Moderators remove them**:

    ```
    /permissions set command:keyword role:@Members
    /permissions set command:keyword delete role:@Moderators
    ```
