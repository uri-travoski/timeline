import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

export interface Palette {
  dark: boolean; bg: string; panel: string; card: string; raised: string; line: string; text: string; muted: string;
  accent: string; accentSoft: string; accentText: string; danger: string;
}

const dark: Palette = { dark: true, bg: '#0b0d12', panel: '#12151c', card: '#161a23', raised: '#1d2130', line: '#232836', text: '#e7e9ee', muted: '#8b93a7', accent: '#7c6cff', accentSoft: '#2a2550', accentText: '#a99dff', danger: '#ef4444' };
const light: Palette = { dark: false, bg: '#f5f6fa', panel: '#ffffff', card: '#ffffff', raised: '#f0f1f6', line: '#e3e5ee', text: '#141824', muted: '#6b7286', accent: '#16161a', accentSoft: '#e8e8ed', accentText: '#16161a', danger: '#ef4444' };

export const THEMES: Record<string, Palette> = {
  light,
  dark,
  amoled: { ...dark, bg: '#000', panel: '#050505', card: '#0c0c0e', raised: '#17171b', line: '#1f1f25', accent: '#8b7bff', accentSoft: '#221e45', accentText: '#b3a8ff' },
  nord: { ...dark, bg: '#2e3440', panel: '#333a47', card: '#3b4252', raised: '#434c5e', line: '#4c566a', text: '#eceff4', muted: '#a3adc2', accent: '#88c0d0', accentSoft: '#3b5361', accentText: '#8fd0e3' },
  ocean: { ...dark, bg: '#071521', panel: '#0b1d2c', card: '#0f2436', raised: '#153049', line: '#1d3a55', text: '#e3eef8', muted: '#8aa4bd', accent: '#38bdf8', accentSoft: '#0f3550', accentText: '#7dd3fc' },
  forest: { ...dark, bg: '#0f1712', panel: '#131d17', card: '#17231c', raised: '#1f2e25', line: '#2a3b30', text: '#e5efe8', muted: '#8fa597', accent: '#34d399', accentSoft: '#163a2b', accentText: '#6ee7b7' },
  sepia: { ...light, bg: '#f4ecd8', panel: '#fbf5e6', card: '#fdf8ec', raised: '#efe4c8', line: '#e2d4b0', text: '#3d3021', muted: '#7d6a50', accent: '#b4532a', accentSoft: '#f3dcc8', accentText: '#9a3f18' },
  rose: { ...light, bg: '#fff5f7', raised: '#ffe9ee', line: '#fbd5de', text: '#2a1219', muted: '#8c5a68', accent: '#e11d48', accentSoft: '#ffe0e8', accentText: '#be123c' },
};
/** Unread highlight (posts, reminders, notifications). */
export const GOLD = '#d4a420';
export const GOLD_TINT = 'rgba(212,164,32,0.10)';
export const THEME_NAMES = ['system', 'light', 'dark', 'amoled', 'nord', 'ocean', 'forest', 'sepia', 'rose'];

const Ctx = createContext<Palette>(dark);
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ name, children }: { name: string; children: ReactNode }) {
  const scheme = useColorScheme();
  const p = name === 'system' || !THEMES[name] ? (scheme === 'light' ? light : dark) : THEMES[name];
  return <Ctx.Provider value={p}>{children}</Ctx.Provider>;
}
