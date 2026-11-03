import { CopyIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { t } from '../lib/i18n';

/** Une valeur à copier (lien, jeton, clé): champ en lecture seule et bouton Copier. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé: le champ reste sélectionnable à la main.
    }
  };
  return (
    <div className="linkbox">
      <input className="input" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn-line" onClick={() => void copy()}>
        <CopyIcon size={16} aria-hidden />
        <span aria-live="polite">{copied ? t('Copié') : t('Copier')}</span>
      </button>
    </div>
  );
}
