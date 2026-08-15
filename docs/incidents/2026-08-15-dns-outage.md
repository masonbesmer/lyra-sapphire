# Lyra Prod Incident — 2026-08-15: bot down on `EAI_AGAIN discord.com` (recurrence)

## Symptom

`lyra-bot` crash-looping since ~2026-08-14 22:50 UTC: every boot logs
`FATAL - Error: getaddrinfo EAI_AGAIN discord.com` ~10s after "Logging in", then the
process exits and Docker restarts it. Lavalink stayed up but received no bot
connection after its 22:15 UTC restart. The explicit `dns: 1.1.1.1/1.0.0.1` pinned in
PR #620 did **not** prevent this.

## Root cause

Same Unraid/Docker bug family as the 2026-08-13 incident (§4 of
[2026-08-13-prod-outage.md](2026-08-13-prod-outage.md)), now fully understood via
[docker/for-linux#1534](https://github.com/docker/for-linux/issues/1534) and
[Unraid bug r2218](https://forums.unraid.net/bug-reports/stable-releases/docker-user-defined-networks-cannot-access-internet-after-a-reboot-r2218/):

- On host boot, Docker restores existing user-defined bridge networks, then libvirt
  **inserts** its `LIBVIRT_FWX/FWO/FWI` rules at the top of the iptables `FORWARD`
  chain — above the restored Docker network rules.
- Result: every custom bridge network that existed **before** the reboot loses all
  outbound traffic (not just DNS — pinned resolvers like 1.1.1.1 are unreachable too,
  which is why PR #620's fix didn't help). The default bridge and networks created
  **after** boot are unaffected, because newly created networks insert their rules
  above libvirt's.

Timeline fit: moonlink rebooted ~2026-08-14 22:10–22:15 UTC (Lavalink relaunched
22:15). The 22:50 UTC webhook deploy recreated the containers but **reused** the
pre-reboot `lyra-sapphire-prod_lyra-network`, whose FORWARD rules were now stuck
below libvirt's — so the bot came up with no outbound connectivity and crash-looped
for ~18h.

## Fix (this PR)

Renamed the compose network `lyra-network` → `lyra-net`. Compose treats this as a new
network, so the merge-triggered deploy creates a fresh bridge whose iptables rules
land above libvirt's, restoring outbound connectivity. The old
`lyra-sapphire-prod_lyra-network` is left dangling and gets removed by Komodo's
auto-prune (or `docker network prune`).

This heals the current outage through the normal PR → auto-deploy pipeline, but the
underlying trigger (host reboot) remains.

## Runbook: if `EAI_AGAIN` comes back after a moonlink reboot

Any of these, in order of preference:

1. **Komodo UI → lyra-sapphire-prod → Destroy, then Deploy.** `compose down` removes
   the project network; `up` recreates it with correct rule ordering. (~30s downtime;
   a plain Restart/Deploy is NOT enough — the network must be deleted.)
2. Enable **"Destroy before deploy"** on the stack to make every deploy self-healing
   (costs a full stack down/up per deploy).
3. Restart the Docker service on moonlink (Settings → Docker → disable/enable).

## Permanent host-side options (not actioned yet — Mason's call)

- **Disable the VM manager** on moonlink if no VMs are in use — no libvirt rules, no
  ordering conflict.
- **Boot-time reorder script** (User Scripts plugin, "At Startup of Array"): after
  docker + libvirt are up, restart the Docker service once so its rules are
  re-inserted above libvirt's; or surgically `iptables -D`/`-I` the per-bridge
  FORWARD rules above `LIBVIRT_FWX`.
- Track the upstream Unraid bug (r2218) for a real fix.

## Related deploy-pipeline note

Komodo's status poller currently reports a stale `git pull` failure on its clone
("already a rebase-merge directory") — same failure mode as §6 of the 08-13 incident.
The stack has `reclone: true` so deploys should survive it, but if the merge of this
PR does not auto-deploy, clear that lock (toggle Reclone in the stack settings) and
redeploy.
