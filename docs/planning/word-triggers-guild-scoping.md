# TODO — Make word triggers guild-scoped

**Status:** open
**Raised:** 2026-08-26, while adding the dashboard's admin Config tab
**Severity:** high — cross-guild data leak and cross-guild write access

## The problem

`word_triggers` is keyed by `keyword` alone:

```sql
CREATE TABLE IF NOT EXISTS word_triggers (
	keyword  TEXT PRIMARY KEY,
	response TEXT NOT NULL
)
```

There is no `guild_id` column anywhere in the table, the listener, or the
commands. Every trigger is therefore global: one row fires in every server Lyra
is in, and anyone who can write a trigger writes it for all of them.

That was survivable while `/keyword` was the only way in. It is not survivable
now that the Config tab surfaces the list to any guild admin — an admin of one
server can read and rewrite the triggers of every other server. The tab ships
with a warning banner as a stopgap; this is the real fix.

Worth noting while the file is open: `/keyword` has **no permission gate at
all** (see [`src/commands/General/keyword.ts`](../../src/commands/General/keyword.ts)) — no
`requiredUserPermissions`, no precondition. Any member of any server can add,
edit, or delete a global trigger today.

## What has to change

### 1. Schema + migration

SQLite cannot alter a primary key in place, so this is a table rebuild in
[`src/lib/database.ts`](../../src/lib/database.ts), guarded the same way the
`command_permissions` and `starboard_config` migrations already are:

```sql
CREATE TABLE word_triggers (
	guild_id TEXT NOT NULL,
	keyword  TEXT NOT NULL,
	response TEXT NOT NULL,
	PRIMARY KEY (guild_id, keyword)
)
```

Detect the old shape with `PRAGMA table_info(word_triggers)` (no `guild_id`
column), rebuild, then backfill.

### 2. Backfill — needs a decision before anything is written

Existing rows carry no guild, so there is no correct answer derivable from the
data. Pick one:

- **Fan out** — copy every existing row into every guild in
  `container.client.guilds.cache`. Preserves current behavior exactly, but the
  cache isn't populated when `database.ts` runs at import time, so this has to
  happen on `clientReady`, not during the migration. Multiplies the row count.
- **Drop** — start clean and let admins re-add per server. Cheapest, loses data.
- **Park under a sentinel** — backfill `guild_id = '0'` and treat it as
  "unassigned" in the UI so admins can claim rows into their guild. Most work,
  no data loss, no fan-out blowup.

Fan-out is probably right if any of these triggers are actually in use; confirm
against the live database first (`SELECT COUNT(*) FROM word_triggers`).

### 3. Call sites

All of these currently run unscoped queries and need a `guild_id`:

| File                                                                                                                 | What                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/listeners/WordTriggers.ts:16`](../../src/listeners/WordTriggers.ts)                                            | Add `AND guild_id = ?`. Decide DM behavior — `message.guildId` is null there, so today a DM matches every global trigger. Simplest correct answer: return early when there's no guild.                                       |
| [`src/lib/config.ts:197-209`](../../src/lib/config.ts)                                                               | `getWordTriggers` / `setWordTrigger` / `deleteWordTrigger` all take a `guildId` first arg.                                                                                                                                   |
| [`src/commands/General/keyword.ts`](../../src/commands/General/keyword.ts)                                           | Six raw queries across the slash and message variants (lines 54, 63, 74, 83, 136, 145, 155, 163). Route them through the `lib/config.ts` helpers instead of re-rolling SQL, and add a permission gate while you're in there. |
| [`src/routes/api/guilds/[guild]/admin/triggers.post.ts`](../../src/routes/api/guilds/[guild]/admin/triggers.post.ts) | Pass `resolved.guild.id` into all three helper calls.                                                                                                                                                                        |
| [`src/routes/api/guilds/[guild]/admin.get.ts:38`](../../src/routes/api/guilds/[guild]/admin.get.ts)                  | `getWordTriggers(guild.id)`.                                                                                                                                                                                                 |

### 4. UI

Drop the `.hint.warn` banner from the Word triggers section of
[`web/src/components/Config.svelte`](../../web/src/components/Config.svelte) once the
scoping lands — it exists only to describe the bug. The `.hint.warn` CSS rule
becomes unused at that point; Svelte will flag it.

## Done when

- A trigger added in guild A does not fire in guild B, and is not visible in
  guild B's Config tab.
- `/keyword` is gated behind a permission check.
- The migration is idempotent — a second boot against an already-migrated
  database is a no-op.
