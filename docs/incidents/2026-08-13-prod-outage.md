# Lyra Prod Incident Summary — 2026-08-13

Full rundown of everything found and fixed tonight in `lyra-sapphire`, in the order it happened.

## 1. Dashboard "No shared servers found"

**Symptom:** The web dashboard (lyra.latte.cx) showed an empty server list for every user, even ones who genuinely shared a server with the bot.

**Root cause:** All 21 files under `src/routes/api/guilds/` passed an explicit `route:` option to their route constructor. That skipped the framework's filename-based HTTP method inference (`.get.ts` → GET), so the router registered every one of these routes with zero allowed methods — every request, including plain GETs, was rejected with 405 before the handler ever ran. Separately, the 20 nested `[guild]/*` routes used `:guild` (colon syntax) in their hardcoded paths, but the router only treats bracket-wrapped segments (`[guild]`) as dynamic — so those routes could never have matched a real guild ID even without the method bug. Every guild-scoped dashboard action (play, skip, volume, queue, etc.) had been silently broken since the original Shoukaku/Kazagumo migration, not just the guild list.

**Fix:** Removed the hardcoded `route:` override from all 21 files, letting the directory/filename convention correctly infer both path and method. (PR #614)

## 2. SoundCloud playback fails with 404

**Symptom:** `/play source: SoundCloud` finds and queues a track, bot joins voice, but no audio plays.

**Root cause:** Confirmed as an open, unfixed upstream bug in Lavalink itself ([lavalink-devs/Lavalink#1221](https://github.com/lavalink-devs/Lavalink/issues/1221)) — the stock Lavaplayer SoundCloud source manager fails to resolve a valid HLS stream URL from SoundCloud's CDN, returning a 404. Not specific to our setup; identical failure signature on a completely different track was independently reported.

**Fix:** No real fix exists upstream yet. Removed SoundCloud from the `/play` and `/search` source options so the bot doesn't silently "succeed" into dead air. (PR #615, merged as part of #620's promotion to main)

## 3. YouTube search returns "No results found"

This was the deepest rabbit hole of the night, with three layered causes discovered in sequence.

**Layer 1 — diagnostic logging added.** Initial hypothesis was that the bot's search library was silently discarding a real Lavalink error and returning an empty list. Added logging to capture Lavalink's raw response detail on empty searches. (PR #615/#617)

**Layer 2 — the logging never fired.** Investigation found the YouTube plugin's own startup logs (which fire unconditionally, not gated by the debug setting) were completely absent from the boot log — the plugin wasn't loading at all. Root cause: Lavalink's plugin loader tries to create its `plugins/` directory but never checks whether that actually succeeded. The directory on the Unraid host was owned by `root`, but the Lavalink process runs as uid 322 — `mkdir()` failed silently, and the entire plugin bootstrap step exited with zero logging. No YouTube source manager ever got registered, so every YouTube search returned `loadType: empty` regardless of the query. **Fixed by Mason directly on the host:** created `/mnt/user/appdata/lyra/lavalink/plugins` and `chown`'d it to `322:65533`.

**Layer 3 — the real, original bug.** Once the plugin actually loaded, debug logging finally worked and revealed the true cause: all three of Lavalink's playback-capable YouTube clients were failing for three different reasons — `WEB` was getting YouTube's newer SABR streaming response format, which this plugin version can't parse into a playable URL; `TVHTML5_SIMPLY` was hitting a literal "sign in to confirm you're not a bot" challenge; `ANDROID_VR` was hitting "this video requires login." This is almost certainly what caused the original _intermittent_ version of this bug — different videos hit different combinations of these three failure modes.

**Fix:** Checked the newer plugin version (1.18.2) first — its changelog didn't address this specific issue (confirmed via the plugin's own GitHub issue tracker; the maintainer confirmed SABR handling is a known, unresolved gap). Instead, reconfigured which YouTube "clients" the plugin uses: disabled playback on `WEB` (kept it for search only, same as `MUSIC`), and added `MWEB` as a working playback-capable client. (PR #621/#622)

## 4. Docker networking corruption on the host (moonlink) — twice

**Symptom (1st occurrence):** After a container recreate, Docker failed to set up networking — an `iptables` DNAT rule failed with `libxt_tcp.so: cannot read file data: Input/output error`. The bot container got stuck in `created` state, never actually started.

**Root cause:** A documented, still-unresolved Unraid/Docker bug ([docker/for-linux#1534](https://github.com/docker/for-linux/issues/1534) and multiple Unraid forum threads) — user-defined/custom bridge networks lose outbound connectivity after container restarts; Docker's plain default bridge is unaffected. Never root-caused even by Docker's own maintainers.

**Fix (1st occurrence):** Restarted the Docker service on the host (not a full reboot) — this cleared whatever corrupted netfilter state was breaking new-container network attachment. Affected all containers on that host briefly (Forgejo, latte.cx dev/prod, Lyra).

**Symptom (2nd occurrence):** Same pattern recurred later that night — `EAI_AGAIN discord.com` DNS failures — immediately following another container restart (Lavalink, then the bot).

**Fix (2nd occurrence):** Mason declined another Docker service restart and asked for a real fix. Traced the pattern precisely via timestamps: the DNS breakage started exactly at the moment of each explicit container restart, not during any deploy/merge/webhook activity, confirming the restart-triggers-it theory. Added explicit DNS servers (Cloudflare's `1.1.1.1`/`1.0.0.1`) to both services in `docker-compose.prod.yml`, bypassing whatever was broken in the host's embedded DNS forwarding — without needing another full daemon restart. (PR #620)

## 5. Lavalink crash-looping on an unguarded network call

**Symptom:** After the DNS fix, Lavalink entered a rapid crash loop.

**Root cause:** Verified independently from the earlier DNS incident (different failure point in the code, confirmed via stack trace each time) — `PluginManager.checkPluginForUpdates()` makes an unguarded HTTP call to `maven.lavalink.dev` to check for a newer plugin version, with no error handling. When that specific call failed (separate from the actual plugin _download_, which was succeeding every time), it crashed the entire application before startup completed — even though the plugin was already cached on disk and didn't need to be re-downloaded.

**Fix:** Emptied the `lavalink.plugins` version declaration in `application.yml`. Lavalink loads whatever's already in the `plugins/` directory regardless of that declaration, so this just skips the crashing update-check call. Marked temporary with the original value commented inline. (PR #623)

## 6. Deploy pipeline getting stuck on a stale git lock — twice

**Symptom:** Builds/deploys reported success but silently ran against a stale checkout, or hung indefinitely.

**Root cause:** Komodo's build/deploy process runs `git pull --rebase` on its own internal clone of the repo. If that process is ever interrupted (killed, timed out, host hiccup), git leaves a `.git/rebase-merge` lock behind, and Komodo has no self-heal for this — every subsequent pull fails identically until the lock is cleared manually. This hit both the build-host clone and, later, the stack's separate deploy-time clone.

**Fix:** Cleared manually each time — once via SSH into the build host, once via toggling the stack's "Reclone" setting in the Komodo UI. No permanent fix applied tonight; recommended options (moving the builder off the production host, adding a self-heal check, or filing the issue upstream with the Komodo project) were discussed but not actioned.

## Also flagged, not yet fixed

- **Bot reconnect logic doesn't actually retry.** Shoukaku (the bot's Lavalink client library) logs "Reconnecting..." once after a dropped connection but never actually retries, even within its configured 5-try/3-second window. This is why the bot needed manual restarts to recover from Lavalink hiccups tonight instead of self-healing. Worth a real fix so future Lavalink blips don't require manual intervention.
- **Newer YouTube plugin version available** (1.18.2, currently on 1.18.0) — its changelog doesn't fix any of tonight's issues, but it's a legitimate routine bump worth doing eventually for its other fixes.

## Also completed tonight (separate from the incident): debt ledger cleanup

Before the live-incident work above, three batches of items from `docs/planning/music-plan-debt.md` were picked and fixed as planned maintenance, unrelated to any outage:

- **Batch 1** (PR #598): auth property fixes, DJ-role permission gating, WebSocket auth hardening, logout endpoint fix, play-history logging fix.
- **Batch 2** (PR #599): request validation, voice-channel checks, OAuth CSRF protection, player-message cleanup, various permission/config fixes.
- **Batch 3** (PR #600): interaction type fixes, reply-handling cleanup, button state fixes, recorder code dedup, and more.

All are merged to `develop`/`main` and live in production.
