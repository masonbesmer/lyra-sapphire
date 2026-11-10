// Imported by vite.config.ts as well as the app, so this module must stay free of browser APIs.

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'lyra-theme';
