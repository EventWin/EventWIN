/**
 * Thème clair / sombre : choix mémorisé, à défaut la préférence du système.
 * Appliqué au démarrage (main.ts) avant le premier rendu pour éviter un flash.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, remember = false): void {
  document.documentElement.dataset['theme'] = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0D0E13' : '#F6F5F1');
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // stockage indisponible : le thème reste valable pour la session
    }
  }
}

export function initTheme(): void {
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(storedTheme() ?? (prefersDark ? 'dark' : 'light'));
}
