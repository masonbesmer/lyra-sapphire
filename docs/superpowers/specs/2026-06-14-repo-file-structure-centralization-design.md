# Repo File Structure Centralization

**Date:** 2026-06-14

## Problem

Root directory contains 8 markdown files and 2 scripts scattered at top level, making the repo hard to navigate.

## Goal

Move all non-README markdown files into `docs/` (organized by topic) and all scripts into `tools/`.

## New Structure

```
docs/
  setup/
    QUICKSTART.md       (was root/QUICKSTART.md)
    LAVALINK.md         (was root/LAVALINK.md)
  features/
    COMMANDS.md         (was root/COMMANDS.md)
    PERMISSIONS.md      (was root/PERMISSIONS.md)
    STARBOARD.md        (was root/STARBOARD.md)
  dev/
    DEVELOPMENT.md      (was root/DEVELOPMENT.md)
    IMPLEMENTATION.md   (was root/IMPLEMENTATION.md)
  planning/
    music-plan.md       (was root/music-plan.md)
  superpowers/
    specs/              (existing)

tools/
  install.ps1           (was root/install.ps1)
  install.sh            (was root/install.sh)

README.md               (stays at root)
```

## Implementation Steps

1. Create new subdirectories: `docs/setup/`, `docs/features/`, `docs/dev/`, `docs/planning/`, `tools/`
2. Move each file to its destination
3. Update any internal cross-references between docs
4. Update README.md links if it references any moved files
5. Commit

## Out of Scope

- Moving docker-compose files (config, not docs/scripts)
- Moving tsconfig, package.json, or other build config
