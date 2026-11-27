import { container } from '@sapphire/framework';

/**
 * Phishing / scam domain detection for the AutoMod phishing filter.
 *
 * Three sources, checked in order:
 * 1. a community-maintained domain list (downloaded, refreshed every 12 h; set
 *    `PHISHING_DOMAIN_LIST_URL` to another JSON/text list, or to an empty string to turn it off),
 * 2. a small built-in list that works offline,
 * 3. a lookalike check for Discord and Steam typosquats (`dlscord-nitro.gift`, `steamcommunlty.com`).
 * Per-guild extra domains live in the filter's own settings (src/lib/automod.ts).
 */

export const DEFAULT_LIST_URL = 'https://raw.githubusercontent.com/nikolaischunk/discord-phishing-links/main/domain-list.json';
const REFRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const MAX_LIST_BYTES = 20 * 1024 * 1024;

/** Offline fallback: long-lived scam domains that keep coming back. */
const BUILTIN_DOMAINS = [
	'discord-nitro.gift',
	'discordnitro.gift',
	'discord-gift.com',
	'discordgift.site',
	'discord-app.gift',
	'discordapp.gift',
	'dlscord.gift',
	'discrod.gift',
	'steamcommunity.ru',
	'steamcommunitiy.com',
	'steamcommunlty.com',
	'stearncommunity.com',
	'free-nitro.ru',
	'nitro-discord.com'
];

/** Real Discord / Steam domains the lookalike check must never flag. */
const OFFICIAL_DOMAINS = [
	'discord.com',
	'discord.gg',
	'discord.gift',
	'discord.media',
	'discord.dev',
	'discord.new',
	'discord.co',
	'discord.design',
	'discord.store',
	'discord.tools',
	'discordapp.com',
	'discordapp.net',
	'discordstatus.com',
	'discordmerch.com',
	'discordpartygames.com',
	'steamcommunity.com',
	'steampowered.com',
	'steamstatic.com',
	'steamchina.com',
	'steamgames.com',
	'steamusercontent.com',
	'steamcontent.com',
	'steamserver.net',
	'steam-chat.com',
	'steamdeck.com'
];

let remote = new Set<string>();
const builtin = new Set(BUILTIN_DOMAINS);
let lastAttempt = 0;
let lastSuccess = 0;
let loading: Promise<void> | null = null;

function underList(host: string, list: ReadonlySet<string>): boolean {
	if (list.has(host)) return true;
	// Walk up the parents: a.b.scam.com is caught by scam.com.
	let dot = host.indexOf('.');
	while (dot !== -1) {
		const parent = host.slice(dot + 1);
		if (!parent.includes('.')) return false;
		if (list.has(parent)) return true;
		dot = host.indexOf('.', dot + 1);
	}
	return false;
}

function isOfficial(host: string): boolean {
	return OFFICIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Discord spelled with lookalike letters: dlscord, disc0rd, discorcl, dicsord, discordd... */
const DISCORD_LOOKALIKE = /d[il1][sz5][ckq]{1,2}[o0]r(?:cl|d|c|l)|d[il1]c[s5][o0]rd|dis[ck]rd/;
const STEAM_LOOKALIKE = /st[e3][a4]?(?:m|rn)[ckq][o0](?:m|rn){1,2}un[il1]t[iy]{1,2}|st[e3][a4]?(?:m|rn)p[o0]w[e3]?r[e3]?d/;

/**
 * A host that impersonates Discord or Steam: a misspelling (`dlscord.gift`), or the real name
 * on someone else's domain together with bait (`discord-nitro-free.com`, `steamcommunity-trade.ru`).
 */
export function isLookalikeHost(host: string): boolean {
	if (isOfficial(host)) return false;
	const discord = host.match(DISCORD_LOOKALIKE);
	if (discord && discord[0] !== 'discord') return true;
	if (host.includes('discord') && /nitro|gift|free|airdrop|promo|claim/.test(host)) return true;
	const steam = host.match(STEAM_LOOKALIKE);
	if (steam && steam[0] !== 'steamcommunity' && steam[0] !== 'steampowered') return true;
	if (host.includes('steamcommunity') || host.includes('steampowered')) return true;
	return false;
}

/** Parses either `{ "domains": [...] }` JSON or a plain one-domain-per-line list. */
export function parseDomainList(body: string): string[] {
	const text = body.trim();
	let entries: unknown[] = [];
	if (text.startsWith('{') || text.startsWith('[')) {
		const parsed = JSON.parse(text) as unknown;
		entries = Array.isArray(parsed)
			? parsed
			: Array.isArray((parsed as { domains?: unknown }).domains)
				? (parsed as { domains: unknown[] }).domains
				: [];
	} else {
		entries = text.split(/\r?\n/);
	}
	return entries
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) =>
			entry
				.trim()
				.toLowerCase()
				.replace(/^www\./, '')
		)
		.filter((entry) => entry && !entry.startsWith('#') && entry.includes('.') && !isOfficial(entry));
}

function listUrl(): string | null {
	const configured = process.env.PHISHING_DOMAIN_LIST_URL;
	if (configured === undefined) return DEFAULT_LIST_URL;
	return configured.trim() || null;
}

async function load(url: string): Promise<void> {
	const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const body = await response.text();
	if (body.length > MAX_LIST_BYTES) throw new Error('list is too large');
	const domains = parseDomainList(body);
	if (!domains.length) throw new Error('list is empty');
	remote = new Set(domains);
	lastSuccess = Date.now();
	container.logger.info(`[automod] loaded ${domains.length} phishing domains`);
}

/** Starts a refresh if the shared list is missing or stale. Never throws; the check uses what it has. */
export function refreshPhishingList(now = Date.now()): Promise<void> {
	const url = listUrl();
	if (!url || loading) return loading ?? Promise.resolve();
	const due = lastSuccess ? now - lastSuccess >= REFRESH_MS : now - lastAttempt >= RETRY_MS || lastAttempt === 0;
	if (!due || now - lastAttempt < RETRY_MS) return Promise.resolve();
	lastAttempt = now;
	loading = load(url)
		.catch((error) => container.logger.warn(`[automod] couldn't load the phishing list from ${url}: ${String(error)}`))
		.finally(() => {
			loading = null;
		});
	return loading;
}

export function isPhishingHost(host: string): boolean {
	void refreshPhishingList();
	return underList(host, remote) || underList(host, builtin) || isLookalikeHost(host);
}

export function phishingListSize(): number {
	return remote.size;
}

/** Test hook: replace the downloaded list. */
export function setPhishingDomainsForTest(domains: string[]): void {
	remote = new Set(domains);
	lastSuccess = Date.now();
	lastAttempt = lastSuccess;
}
