# Repo File Structure Centralization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move 8 scattered root-level markdown files into `docs/` (by topic) and 2 scripts into `tools/`.

**Architecture:** Create `docs/setup/`, `docs/features/`, `docs/dev/`, `docs/planning/`, and `tools/` directories. Move files. Update all internal cross-references.

**Tech Stack:** Git (file moves via `git mv` to preserve history)

---

## File Map

| From | To |
|------|----|
| `QUICKSTART.md` | `docs/setup/QUICKSTART.md` |
| `LAVALINK.md` | `docs/setup/LAVALINK.md` |
| `COMMANDS.md` | `docs/features/COMMANDS.md` |
| `PERMISSIONS.md` | `docs/features/PERMISSIONS.md` |
| `STARBOARD.md` | `docs/features/STARBOARD.md` |
| `DEVELOPMENT.md` | `docs/dev/DEVELOPMENT.md` |
| `IMPLEMENTATION.md` | `docs/dev/IMPLEMENTATION.md` |
| `music-plan.md` | `docs/planning/music-plan.md` |
| `install.ps1` | `tools/install.ps1` |
| `install.sh` | `tools/install.sh` |

**Modified:** `README.md` (update 6 links), `docs/setup/QUICKSTART.md` (update 3 links after move)

---

### Task 1: Create new directories

**Files:**
- Create: `docs/setup/` (directory)
- Create: `docs/features/` (directory)
- Create: `docs/dev/` (directory)
- Create: `docs/planning/` (directory)
- Create: `tools/` (directory)

- [ ] **Step 1: Create directories**

```bash
mkdir -p docs/setup docs/features docs/dev docs/planning tools
```

Expected: no output, directories created.

---

### Task 2: Move files with git mv

**Files:**
- Move all 10 files to their new locations

- [ ] **Step 1: Move setup docs**

```bash
git mv QUICKSTART.md docs/setup/QUICKSTART.md
git mv LAVALINK.md docs/setup/LAVALINK.md
```

- [ ] **Step 2: Move feature docs**

```bash
git mv COMMANDS.md docs/features/COMMANDS.md
git mv PERMISSIONS.md docs/features/PERMISSIONS.md
git mv STARBOARD.md docs/features/STARBOARD.md
```

- [ ] **Step 3: Move dev docs**

```bash
git mv DEVELOPMENT.md docs/dev/DEVELOPMENT.md
git mv IMPLEMENTATION.md docs/dev/IMPLEMENTATION.md
```

- [ ] **Step 4: Move planning docs**

```bash
git mv music-plan.md docs/planning/music-plan.md
```

- [ ] **Step 5: Move scripts**

```bash
git mv install.ps1 tools/install.ps1
git mv install.sh tools/install.sh
```

- [ ] **Step 6: Verify moves**

```bash
git status
```

Expected: 10 renames staged, no untracked files in root (besides README.md and config files).

---

### Task 3: Update cross-references in README.md

**Files:**
- Modify: `README.md` (6 link updates)

`README.md` currently links to the old paths. Update all of them.

- [ ] **Step 1: Update QUICKSTART.md links (lines 7 and 61)**

Find:
```
[QUICKSTART.md](./QUICKSTART.md)
```
Replace with:
```
[QUICKSTART.md](./docs/setup/QUICKSTART.md)
```

Find:
```
[Quick Start Guide](./QUICKSTART.md)
```
Replace with:
```
[Quick Start Guide](./docs/setup/QUICKSTART.md)
```

- [ ] **Step 2: Update STARBOARD.md link (line 28)**

Find:
```
[STARBOARD.md](./STARBOARD.md)
```
Replace with:
```
[STARBOARD.md](./docs/features/STARBOARD.md)
```

- [ ] **Step 3: Update all LAVALINK.md links**

There are 5 occurrences of `./LAVALINK.md` and 1 of `(./LAVALINK.md` in README.md. Replace all:

Find: `./LAVALINK.md`
Replace with: `./docs/setup/LAVALINK.md`

- [ ] **Step 4: Verify no stale root-relative links remain**

```bash
grep -n "\./QUICKSTART\|\./LAVALINK\|\./STARBOARD\|\./COMMANDS\|\./DEVELOPMENT\|\./IMPLEMENTATION\|\./PERMISSIONS\|\./music-plan\|\./install" README.md
```

Expected: no output.

---

### Task 4: Update cross-references inside QUICKSTART.md

**Files:**
- Modify: `docs/setup/QUICKSTART.md` (3 link updates — paths changed when file moved to docs/setup/)

QUICKSTART.md is now at `docs/setup/QUICKSTART.md`. Its relative links must be updated from `./FILE.md` to sibling-relative paths within `docs/`.

- [ ] **Step 1: Verify LAVALINK.md links need no change**

Both files land in `docs/setup/`, so the relative link `./LAVALINK.md` inside QUICKSTART.md remains valid.

```bash
grep -n "LAVALINK.md" docs/setup/QUICKSTART.md
```

Expected: lines containing `./LAVALINK.md` — no edit needed.

- [ ] **Step 2: Update DEVELOPMENT.md links (2 occurrences)**

Find:
```
[DEVELOPMENT.md](./DEVELOPMENT.md)
```
Replace with:
```
[DEVELOPMENT.md](../dev/DEVELOPMENT.md)
```

- [ ] **Step 3: Update COMMANDS.md link**

Find:
```
[COMMANDS.md](./COMMANDS.md)
```
Replace with:
```
[COMMANDS.md](../features/COMMANDS.md)
```

- [ ] **Step 4: Verify QUICKSTART.md links**

```bash
grep -n "\./DEVELOPMENT\|\./COMMANDS" docs/setup/QUICKSTART.md
```

Expected: no output.

---

### Task 5: Commit

- [ ] **Step 1: Stage README.md**

```bash
git add README.md docs/setup/QUICKSTART.md
```

- [ ] **Step 2: Verify full staged diff**

```bash
git status
git diff --staged --stat
```

Expected: 10 renames + 2 modifications staged.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: centralize docs into docs/ subdirs and scripts into tools/"
```
