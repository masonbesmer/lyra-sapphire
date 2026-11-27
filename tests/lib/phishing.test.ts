import { container } from '@sapphire/framework';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { isLookalikeHost, isPhishingHost, parseDomainList, setPhishingDomainsForTest } from '../../src/lib/phishing';

beforeAll(() => {
	// No network in tests.
	process.env.PHISHING_DOMAIN_LIST_URL = '';
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

describe('isLookalikeHost', () => {
	it.each([
		'dlscord.gift',
		'disc0rd-app.com',
		'discorcl.com',
		'dicsord.net',
		'discord-nitro-free.com',
		'steamcommunlty.com',
		'stearncommunity.ru',
		'steamcommunity-trade.ru'
	])('flags %s', (host) => expect(isLookalikeHost(host)).toBe(true));

	it.each([
		'discord.com',
		'cdn.discordapp.com',
		'discord.gg',
		'discord.js.org',
		'discordbotlist.com',
		'steamcommunity.com',
		'store.steampowered.com',
		'example.com',
		'disco.party'
	])('leaves %s alone', (host) => expect(isLookalikeHost(host)).toBe(false));
});

describe('parseDomainList', () => {
	it('reads the JSON format', () => {
		expect(parseDomainList('{"domains":["a.com","WWW.B.com","discord.com",1]}')).toEqual(['a.com', 'b.com']);
	});

	it('reads one-per-line text with comments', () => {
		expect(parseDomainList('# list\na.com\n\nb.org\r\nnotadomain\n')).toEqual(['a.com', 'b.org']);
	});
});

describe('isPhishingHost', () => {
	it('checks the downloaded list, including subdomains', () => {
		setPhishingDomainsForTest(['scam-site.xyz']);
		expect(isPhishingHost('scam-site.xyz')).toBe(true);
		expect(isPhishingHost('login.scam-site.xyz')).toBe(true);
		expect(isPhishingHost('scam-site.xyz.example.com')).toBe(false);
	});

	it('checks the built-in list', () => {
		expect(isPhishingHost('discord-nitro.gift')).toBe(true);
		expect(isPhishingHost('github.com')).toBe(false);
	});
});
