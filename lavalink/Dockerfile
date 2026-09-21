# Bakes application.yml into the image so the config ships inside the container instead of
# being bind-mounted from the host.
#
# Why not a bind mount: Komodo checks this repo out under /boot/config/komodo/... and /boot
# is the Unraid USB flash - vfat, which has no Unix permission bits, so chmod/chown there are
# silent no-ops. The image runs as uid 322, could not read a config mounted from vfat, and
# crash-looped with "application.yml (Permission denied)". Mounting via appdata instead worked
# but meant keeping a second copy of the file in sync on the host.
#
# The base image ships only Lavalink.jar - there is no default config to fall back to. Without
# this file Lavalink boots with no plugins at all and silently falls back to the deprecated
# built-in YouTube source, losing the pinned youtube-plugin build, remoteCipher and OAuth.
# The Ubuntu variant, not -alpine: Discord rejects every voice connection with close code 4017
# ("E2EE/DAVE protocol required") since the March 2026 enforcement, so playback needs Lavalink's
# DAVE support to actually initialise. Lavalink's README puts DAVE's floor at glibc 2.35 - the
# Ubuntu image is eclipse-temurin:18-jre-jammy, which is exactly that; the alpine image is musl
# and was the one in prod when players joined, held position=0 and got closed with 4017. Same
# uid/gid 322, so nothing below changes.
FROM ghcr.io/lavalink-devs/lavalink:4

# 0644 explicitly: root-owned but world-readable, so uid 322 can read it regardless of whatever
# mode the file happened to carry in the build context.
COPY --chmod=644 lavalink/application.yml /opt/Lavalink/application.yml
