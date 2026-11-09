import { get, writable } from 'svelte/store';

export type Theme = 'light' | 'dark';
export type ThemeChoice = 'system' | Theme;

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

// The pre-paint script in index.html reads the same key and resolves the same way;
// keep the two in step.
const STORAGE_KEY = 'lyra-theme';
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
