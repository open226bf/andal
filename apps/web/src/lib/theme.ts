import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

const KEY = 'andal-theme';
const root = () => document.documentElement;

function systemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function read(): 'light' | 'dark' {
  const forced = root().dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return systemDark() ? 'dark' : 'light';
}

/** Applique le thème mémorisé au démarrage, avant le premier rendu. */
export function restoreTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') root().dataset.theme = saved;
  } catch {
    // Stockage indisponible: on suit le système.
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setTheme(read());
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const toggle = useCallback(() => {
    const next = read() === 'dark' ? 'light' : 'dark';
    root().dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Ignoré: le choix vaut pour la session.
    }
    setTheme(next);
  }, []);
  return { theme, toggle };
}

/**
 * Compteur qui change à chaque changement de thème ou de volume: les rendus
 * qui lisent les couleurs (Mermaid) s'en servent pour se refaire.
 */
let version = 0;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  const bump = () => {
    version += 1;
    listeners.forEach((l) => l());
  };
  new MutationObserver(bump).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-vol'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', bump);
}

export function usePaletteVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
