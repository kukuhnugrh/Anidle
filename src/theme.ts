/** Night mode is the default; the choice lives in the anidle_theme cookie (read by index.html before first paint). */
export type Theme = 'dark' | 'light';

const COOKIE = 'anidle_theme';
// Browsers cap cookie lifetime at 400 days.
const MAX_AGE = 400 * 86_400;
const THEME_COLOR: Record<Theme, string> = { dark: '#161824', light: '#fffdf5' };

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  document.cookie = `${COOKIE}=${theme}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}
