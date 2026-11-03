// Redoc (≈1 Mo) ne se charge que sur la page d'une spec, depuis notre propre origine (CSP « script-src 'self' »).
import redocUrl from 'redoc/bundles/redoc.standalone.js?url';
import { t } from './i18n';
import { cssVar } from './theme';

interface RedocGlobal {
  init(spec: unknown, options: Record<string, unknown>, element: HTMLElement, callback?: (error?: unknown) => void): void;
}

declare global {
  interface Window {
    Redoc?: RedocGlobal;
  }
}

let loading: Promise<RedocGlobal> | null = null;

export function loadRedoc(): Promise<RedocGlobal> {
  if (window.Redoc) return Promise.resolve(window.Redoc);
  loading ??= new Promise<RedocGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = redocUrl;
    script.async = true;
    script.onload = () => (window.Redoc ? resolve(window.Redoc) : reject(new Error(t('Redoc ne s’est pas initialisé.'))));
    script.onerror = () => {
      loading = null;
      reject(new Error(t('Redoc ne se charge pas.')));
    };
    document.head.append(script);
  });
  return loading;
}

/** Thème Redoc tiré des jetons d'Andal: mêmes polices, mêmes encres, clair ou sombre. */
export function redocTheme(): Record<string, unknown> {
  const ink = cssVar('--ink');
  const ink2 = cssVar('--ink-2');
  return {
    spacing: { unit: 5, sectionHorizontal: 32, sectionVertical: 28 },
    breakpoints: { small: '50rem', medium: '75rem', large: '105rem' },
    colors: {
      primary: { main: cssVar('--vol-deep') || ink },
      success: { main: cssVar('--ok') },
      error: { main: cssVar('--err') },
      text: { primary: ink, secondary: ink2 },
      border: { dark: cssVar('--rule-2'), light: cssVar('--rule') },
      // Texte blanc sur la pastille du verbe: des teintes moyennes, lisibles en clair comme en sombre.
      http: { get: '#1D7A46', post: '#4A3FC0', put: '#8A5F0A', patch: '#8A5F0A', delete: '#B3261E', head: '#4A5266', options: '#4A5266' },
    },
    typography: {
      fontSize: '15px',
      lineHeight: '1.6',
      fontFamily: cssVar('--font-ui'),
      smoothing: 'antialiased',
      headings: { fontFamily: cssVar('--font-ui'), fontWeight: '700' },
      code: { fontFamily: cssVar('--font-mono'), fontSize: '13px', color: cssVar('--t-flag'), backgroundColor: cssVar('--code-bg') },
      links: { color: cssVar('--vol-deep') || ink, visited: cssVar('--vol-deep') || ink, hover: ink },
    },
    sidebar: { backgroundColor: cssVar('--desk'), textColor: ink, activeTextColor: ink, width: '270px', groupItems: { textTransform: 'none' } },
    rightPanel: { backgroundColor: '#1C2230', textColor: '#E7E9EF', width: '42%' },
    codeBlock: { backgroundColor: '#11151E' },
  };
}
