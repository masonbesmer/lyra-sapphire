import { EmbedBuilder } from 'discord.js';

export async function fetchLyrics(query: string): Promise<string | null> {
	try {
		const { Client } = await import('genius-lyrics');
		const client = new Client();
		const searches = await client.songs.search(query);
		if (!searches.length) return null;
		const lyrics = await searches[0].lyrics();
		return lyrics || null;
	} catch {
		return null;
	}
}

export function buildLyricsEmbeds(title: string, lyrics: string): EmbedBuilder[] {
	const maxLen = 4096;
	const chunks: string[] = [];
	let remaining = lyrics;
	while (remaining.length > 0) {
		chunks.push(remaining.slice(0, maxLen));
		remaining = remaining.slice(maxLen);
	}
	return chunks.map((chunk) => new EmbedBuilder().setTitle(`📜 ${title}`.slice(0, 256)).setDescription(chunk).setColor(0xffdd57));
}
