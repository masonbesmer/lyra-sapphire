# Lyra Bot Permissions System

The Lyra bot now includes a simple Discord role-based permissions system that is backwards compatible with existing commands.

## How it Works

- **Default Behavior**: All commands are accessible to all users (backwards compatible)
- **Role-Based Permissions**: Commands can optionally require specific Discord roles
- **Management**: Only MAXTAC (bot owners) can modify permissions
- **Flexibility**: Permissions can be set, removed, listed, and checked

## Usage

### Setting Permissions (MAXTAC Only)

```bash
# Require a specific role for a command
/permissions set command:keyword role:@Moderators

# Remove role requirement (back to default)
/permissions remove command:keyword

# List all commands with role requirements
/permissions list

# Check what role is required for a command
/permissions check command:keyword
```

### For Command Developers

To enable permissions checking on your command, add the `RolePermission` precondition:

```typescript
@ApplyOptions<Command.Options>({
	description: 'My command description',
	preconditions: ['RolePermission']
})
export class MyCommand extends Command {
	// ... command implementation
}
```

### Backwards Compatibility

- Existing commands without permissions continue to work for all users
- Commands can opt-in to the permissions system by adding the `RolePermission` precondition
- If no role requirement is set in the database, commands remain accessible to all users

## Database Schema

The permissions are stored in the SQLite database in the `command_permissions` table:

```sql
CREATE TABLE command_permissions (
    command_name TEXT PRIMARY KEY,
    required_role_id TEXT NOT NULL
);
```

## Examples

1. **Restrict music commands to DJs only**:

    ```
    /permissions set command:play role:@DJ
    /permissions set command:skip role:@DJ
    ```

2. **Allow moderators to manage keywords**:

    ```
    /permissions set command:keyword role:@Moderators
    ```

3. **Remove restrictions**:
    ```
    /permissions remove command:play
    ```
