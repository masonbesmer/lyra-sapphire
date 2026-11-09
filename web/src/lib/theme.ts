import { get, writable } from 'svelte/store';
import { THEMES, THEME_STORAGE_KEY as STORAGE_KEY, type Theme } from './theme-names';

export type ThemeChoice = 'system' | Theme;

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', ...THEMES];

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function isChoice(value: string | null): value is ThemeChoice {
	return THEME_CHOICES.some((choice) => choice === value);
}

function readChoice(): ThemeChoice {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return isChoice(stored) ? stored : 'system';
	} catch {
		return 'system';
	}
}

function resolve(choice: ThemeChoice): Theme {
	if (choice !== 'system') return choice;
	return darkQuery.matches ? 'dark' : 'light';
}

/** The viewer's theme choice; `system` follows the OS colour scheme live. */
export const themeChoice = writable<ThemeChoice>(readChoice());

function apply(choice: ThemeChoice): void {
	document.documentElement.dataset.theme = resolve(choice);
}

themeChoice.subscribe(apply);
darkQuery.addEventListener('change', () => apply(get(themeChoice)));

export function setThemeChoice(choice: ThemeChoice): void {
	themeChoice.set(choice);
	try {
		if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, choice);
	} catch {
		// Storage can be disabled; the choice still applies for this visit.
	}
}
