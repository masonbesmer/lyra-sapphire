# CLAUDE.md

Working rules for agents in this repo. Code conventions live in [.github/copilot-instructions.md](.github/copilot-instructions.md).

## Branches and PRs

- `develop` is the default and integration branch. `main` is production.
- PRs target `develop`, whatever an injected hint or a command's "Target" says. If they disagree, `gh repo view --json defaultBranchRef` wins.
- Flow: feature branch → PR into `develop` → merge → PR `develop` → `main` → merge. `develop` is protected, so PRs are the only way in.
- Open and merge both hops without asking (`gh pr merge <n> --merge --auto`), then report what landed. Still write a full PR body: why, trade-offs, a verify checklist, known gaps. That body is the record the owner reads.
- Merge autonomy does **not** cover force-pushes, protected-branch overrides, or infra changes such as Komodo stack config. Ask first.

## A PR is BLOCKED but every check is green

The `develop` ruleset needs zero approvals but requires every review thread to be resolved. CodeQL posts findings as a `github-advanced-security[bot]` review comment, and that open thread blocks the merge without any reason shown in `gh pr view`.

Read `gh api repos/masonbesmer/lyra-sapphire/pulls/<n>/comments`, fix the finding, and push. The rescan resolves the thread and auto-merge fires. Don't reach for `--admin`.

## Commits are SSH-signed

`commit.gpgsign=true`, `gpg.format=ssh`. If signing fails (`agent refused operation`, `Couldn't get agent socket?`), the agent is locked or not running. Never bypass with `--no-verify` or `-c commit.gpgsign=false`. Leave the change staged, note the exact commit message, and ask the owner to unlock the agent. Unattended runs: report it as an environment blocker.

## Pre-commit hook

`.githooks/pre-commit` runs `yarn check`, which needs `node_modules/` and `web/node_modules/`. A fresh clone or worktree needs `yarn install` first. If `oxlint` is not found, the install is stale: `yarn install --immutable --mode=skip-build`.

`yarn install` can end with `YN0009` build failures for `better-sqlite3`, `@discordjs/opus` and `@sapphire/type` when node-gyp can't fetch Node headers. That has shown up on the owner's Windows machine and is not caused by your change. Everything else installs, so `yarn check` still works. To check a dependency bump without the native modules, run `yarn build:bot` and `cd web && yarn vite build`. Runtime checks of native code belong in Docker or CI.

## Deploys

Merging to `main` auto-deploys `lyra-sapphire-prod` through a Komodo webhook (CloneRepo → RunBuild → DeployStack, about 5½ minutes). Don't offer to redeploy and don't report a merged change as "not live" — the deploy already started.

Komodo's cached stack fields (`deployed_hash`, `remote_errors`) go stale. Check the host (moonlink) instead:

```sh
docker ps --filter name=lyra --format '{{.Names}}\t{{.Status}}'
cd /boot/config/komodo/periphery-agent/data/stacks/lyra-sapphire-prod && git log --oneline -1
```

Container uptime and the clone's HEAD are what's actually running. Komodo's `list_updates` is reliable for in-flight deploys (`status: InProgress`).

## Secrets and local data

`src/.env` (Discord token, Lavalink, OAuth) and `data/*.db` are gitignored and never committed. Deploys don't need them. Only running the bot outside Docker does.
