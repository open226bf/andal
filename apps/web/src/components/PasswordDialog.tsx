import { CheckCircleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { t } from '../lib/i18n';
import { PasswordField } from './PasswordField';

/** Même seuil que l'API (packages/db/src/password.ts): le serveur reste juge. */
const MIN_LENGTH = 12;

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="pop dialog" aria-describedby={undefined}>
          {/* Remonté à chaque ouverture: les champs repartent vides. */}
          {open && <PasswordForm onDone={() => onOpenChange(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < MIN_LENGTH) return setError(t('Le nouveau mot de passe doit faire au moins {n} caractères.', { n: MIN_LENGTH }));
    if (next !== confirm) return setError(t('Les deux saisies du nouveau mot de passe diffèrent.'));
    setPending(true);
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : t('Le changement a échoué. Réessayez dans un instant.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="pop-head">
        <Dialog.Title asChild>
          <h2>{t('Changer le mot de passe')}</h2>
        </Dialog.Title>
        <Dialog.Close className="icon-btn sm" aria-label={t('Fermer')}>
          <XIcon size={18} aria-hidden />
        </Dialog.Close>
      </div>
      {done ? (
        <div className="dialog-body">
          <p className="form-ok" role="status">
            <CheckCircleIcon size={18} aria-hidden />
            {t('Mot de passe changé. Vos autres sessions sont fermées.')}
          </p>
          <button type="button" className="btn-ink" onClick={onDone} autoFocus>
            {t('Fermer')}
          </button>
        </div>
      ) : (
        <form className="dialog-body" onSubmit={(e) => void submit(e)}>
          {error && (
            <p className="form-error" role="alert">
              <WarningCircleIcon size={18} aria-hidden />
              {error}
            </p>
          )}
          <PasswordField label={t('Mot de passe actuel')} autoComplete="current-password" required autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          <PasswordField
            label={t('Nouveau mot de passe')}
            hint={t("Au moins {n} caractères. Une phrase de passe fait très bien l'affaire.", { n: MIN_LENGTH })}
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <PasswordField label={t('Confirmez le nouveau mot de passe')} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button type="submit" className="btn-ink" disabled={pending}>
            {pending ? t('Enregistrement…') : t('Changer le mot de passe')}
          </button>
        </form>
      )}
    </>
  );
}
