import { TranslateIcon } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { locale, LOCALES, setLocale, t, type Locale } from '../lib/i18n';

/**
 * Français ou anglais. Connecté, le choix suit aussi le compte (emails compris);
 * la page se recharge dans la nouvelle langue.
 */
export function LanguageSwitch({ signedIn }: { signedIn: boolean }) {
  const choose = async (next: Locale) => {
    if (next === locale) return;
    if (signedIn) await api('/me/locale', { method: 'PUT', body: JSON.stringify({ locale: next }) }).catch(() => undefined);
    setLocale(next);
  };
  return (
    <div className="lang-switch" role="group" aria-label={t('Langue de l’interface')}>
      <TranslateIcon size={16} aria-hidden />
      {LOCALES.map((l) => (
        <button key={l.id} type="button" lang={l.id} aria-pressed={l.id === locale} onClick={() => void choose(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
