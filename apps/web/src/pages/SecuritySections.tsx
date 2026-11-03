import { CheckCircleIcon, DesktopIcon, DeviceMobileIcon, DownloadSimpleIcon, ShieldCheckIcon, SignOutIcon, WarningIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { FormError } from '../components/AuthCard';
import { CopyField } from '../components/CopyField';
import { ConfirmDialog, Modal, type Confirmation } from '../components/Dialog';
import { api, errorMessage, useMfa, useSessions, type OpenSession } from '../lib/api';
import { date, dateTime, relative } from '../lib/format';
import { t, tn } from '../lib/i18n';

/** Champ de code à 6 chiffres (ou code de secours): le clavier numérique et le remplissage par SMS/app sur mobile. */
export function CodeField({ id, label, value, onChange, recovery = false, autoFocus = true }: { id: string; label: string; value: string; onChange: (v: string) => void; recovery?: boolean; autoFocus?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input code-input"
        required
        autoFocus={autoFocus}
        autoComplete="one-time-code"
        inputMode={recovery ? 'text' : 'numeric'}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={recovery ? 20 : 7}
        placeholder={recovery ? 'xxxxx-xxxxx' : '123 456'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Les dix codes de secours, montrés une seule fois: à copier ou à télécharger. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = `${t('Codes de secours Andal ({host})', { host: location.host })}\n${t("Chacun sert une seule fois, à la place du code de l'application.")}\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: t('andal-codes-de-secours.txt') });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <p className="token-once" role="note">
        <WarningIcon size={18} aria-hidden />
        {t('Rangez ces codes hors du téléphone (gestionnaire de mots de passe, papier). Ils ne seront plus jamais affichés; chacun sert une fois si le téléphone manque.')}
      </p>
      <ol className="recovery-codes" aria-label={t('Codes de secours')}>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="recovery-tools">
        <button type="button" className="btn-line sm" onClick={() => void navigator.clipboard.writeText(codes.join('\n'))}>
          {t('Copier les codes')}
        </button>
        <button type="button" className="btn-line sm" onClick={download}>
          <DownloadSimpleIcon size={16} aria-hidden />
          {t('Télécharger (.txt)')}
        </button>
      </div>
    </>
  );
}

export function MfaSection() {
  const mfa = useMfa();
  const queryClient = useQueryClient();
  const [enableOpen, setEnableOpen] = useState(false);
  const [codeAction, setCodeAction] = useState<'disable' | 'regenerate' | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  };
  const state = mfa.data;
  if (!state) return mfa.isError ? <FormError>{errorMessage(mfa.error, t('Impossible de lire la double authentification.'))}</FormError> : null;

  return (
    <section className="account-section" aria-labelledby="mfa-title">
      <div className="admin-head">
        <div>
          <h2 id="mfa-title">{t('Double authentification')}</h2>
          <p className="admin-count">
            {!state.available
              ? t('Vous vous connectez par SSO: la double authentification se règle chez votre fournisseur d’identité.')
              : state.enabled
                ? t('Après le mot de passe, Andal demande le code de votre application d’authentification.')
                : t('Un code de votre téléphone en plus du mot de passe: un mot de passe volé ne suffit plus.')}
          </p>
        </div>
        {state.available && !state.enabled && (
          <button type="button" className="btn-ink" onClick={() => setEnableOpen(true)}>
            <ShieldCheckIcon size={18} aria-hidden />
            {t('Activer')}
          </button>
        )}
      </div>
      {state.enabled && (
        <div className="mfa-on">
          <p className="mfa-state">
            <CheckCircleIcon size={20} weight="fill" aria-hidden />
            <span>
              {t('Activée le {date}.', { date: date(state.enabledAt!) })}{' '}
              <span className={state.recoveryCodesLeft <= 3 ? 'mfa-low' : undefined}>
                {state.recoveryCodesLeft <= 3
                  ? tn(state.recoveryCodesLeft, '{n} code de secours restant: pensez à en générer de nouveaux.', '{n} codes de secours restants: pensez à en générer de nouveaux.')
                  : tn(state.recoveryCodesLeft, '{n} code de secours restant.', '{n} codes de secours restants.')}
              </span>
            </span>
          </p>
          <div className="mfa-actions">
            <button type="button" className="btn-line" onClick={() => setCodeAction('regenerate')}>
              {t('Nouveaux codes de secours')}
            </button>
            <button type="button" className="ghost danger" onClick={() => setCodeAction('disable')}>
              {t('Désactiver')}
            </button>
          </div>
        </div>
      )}
      <EnableMfa open={enableOpen} onOpenChange={setEnableOpen} onDone={refresh} />
      <CodeAction action={codeAction} onClose={() => setCodeAction(null)} onDone={refresh} />
    </section>
  );
}

function EnableMfa({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const start = async () => {
    setError(null);
    try {
      setSetup(await api<{ secret: string; qr: string }>('/me/mfa/setup', { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const change = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setSetup(null);
      setCode('');
      setCodes(null);
      setError(null);
    }
  };

  // Un nouveau secret à chaque ouverture: rien n'est enregistré tant que le premier code n'est pas confirmé.
  useEffect(() => {
    if (open) void start();
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<{ recoveryCodes: string[] }>('/me/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) });
      setCodes(result.recoveryCodes);
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={change} title={codes ? t('Double authentification activée') : t('Activer la double authentification')}>
      {codes ? (
        <div className="dialog-body">
          <RecoveryCodes codes={codes} />
          <div className="dialog-actions">
            <Dialog.Close className="btn-ink">{t('J’ai rangé mes codes')}</Dialog.Close>
          </div>
        </div>
      ) : (
        <form className="dialog-body mfa-setup" onSubmit={(e) => void submit(e)}>
          {error && <FormError>{error}</FormError>}
          <ol className="mfa-steps">
            <li>{t('Ouvrez votre application d’authentification (1Password, Bitwarden, Google Authenticator, Aegis…) et scannez ce QR code.')}</li>
            <li>{t('Tapez le code à 6 chiffres qu’elle affiche.')}</li>
          </ol>
          <div className="mfa-qr" aria-busy={!setup}>
            {setup && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qr)}`} width={176} height={176} alt={t('QR code à scanner avec l’application d’authentification')} />}
          </div>
          {setup && (
            <details className="mfa-key">
              <summary>{t('Pas de caméra ? Saisir la clé à la main')}</summary>
              <CopyField label={t('Clé (type: basée sur le temps)')} value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} />
            </details>
          )}
          <CodeField id="mfa-code" label={t('Code de l’application')} value={code} onChange={setCode} />
          <div className="dialog-actions">
            <Dialog.Close className="btn-line">{t('Annuler')}</Dialog.Close>
            <button type="submit" className="btn-ink" disabled={pending || !setup}>
              {t('Activer')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Désactiver, ou générer de nouveaux codes: un code de l'application ou de secours le confirme. */
function CodeAction({ action, onClose, onDone }: { action: 'disable' | 'regenerate' | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = () => {
    setCode('');
    setCodes(null);
    setError(null);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (action === 'disable') {
        await api('/me/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) });
        await onDone();
        close();
      } else {
        const result = await api<{ recoveryCodes: string[] }>('/me/mfa/recovery-codes', { method: 'POST', body: JSON.stringify({ code }) });
        setCodes(result.recoveryCodes);
        await onDone();
      }
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={action !== null} onOpenChange={(open) => !open && close()} title={action === 'disable' ? t('Désactiver la double authentification') : codes ? t('Vos nouveaux codes de secours') : t('Nouveaux codes de secours')}>
      {codes ? (
        <div className="dialog-body">
          <RecoveryCodes codes={codes} />
          <div className="dialog-actions">
            <Dialog.Close className="btn-ink">{t('J’ai rangé mes codes')}</Dialog.Close>
          </div>
        </div>
      ) : (
        <form className="dialog-body" onSubmit={(e) => void submit(e)}>
          {error && <FormError>{error}</FormError>}
          <p className="dialog-text">
            {action === 'disable'
              ? t('Votre mot de passe suffira de nouveau pour vous connecter. Confirmez avec un code de l’application, ou un code de secours.')
              : t('Les anciens codes cesseront de fonctionner. Confirmez avec un code de l’application, ou un code de secours.')}
          </p>
          <CodeField id="mfa-confirm" label={t('Code')} value={code} onChange={setCode} recovery />
          <div className="dialog-actions">
            <Dialog.Close className="btn-line">{t('Annuler')}</Dialog.Close>
            <button type="submit" className={action === 'disable' ? 'btn-danger' : 'btn-ink'} disabled={pending}>
              {action === 'disable' ? t('Désactiver') : t('Générer')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const MOBILE = /iOS|Android/;

export function SessionsSection() {
  const sessions = useSessions();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
  const list = sessions.data ?? [];
  const others = list.filter((s) => !s.current).length;

  return (
    <section className="account-section" aria-labelledby="sessions-title">
      <div className="admin-head">
        <div>
          <h2 id="sessions-title">{t('Sessions ouvertes')}</h2>
          <p className="admin-count">{t('Les navigateurs connectés à votre compte. Fermez ce que vous ne reconnaissez pas, puis changez votre mot de passe.')}</p>
        </div>
        {others > 0 && (
          <button
            type="button"
            className="btn-line"
            onClick={() =>
              setConfirm({
                title: t('Fermer toutes les autres sessions ?'),
                body: tn(
                  others,
                  '{n} session ailleurs sera fermée, pages ouvertes comprises. Celle-ci reste ouverte.',
                  '{n} sessions ailleurs seront fermées, pages ouvertes comprises. Celle-ci reste ouverte.',
                ),
                action: t('Tout fermer'),
                run: async () => {
                  await api('/me/sessions/close-others', { method: 'POST' });
                  await refresh();
                },
              })
            }
          >
            <SignOutIcon size={18} aria-hidden />
            {t('Fermer les autres')}
          </button>
        )}
      </div>
      {sessions.isError && <FormError>{errorMessage(sessions.error, t('Impossible de lister vos sessions.'))}</FormError>}
      <ul className="sessions">
        {list.map((s: OpenSession) => (
          <li key={s.id} className="session" data-current={s.current || undefined}>
            <span className="session-icon" aria-hidden>
              {MOBILE.test(s.device) ? <DeviceMobileIcon size={22} /> : <DesktopIcon size={22} />}
            </span>
            <span className="session-main">
              <b>
                {s.device}
                {s.current && <span className="you">{t('cette session')}</span>}
              </b>
              <span className="session-meta">
                {s.method === 'oidc' ? 'SSO' : s.mfa ? t('Mot de passe et code') : t('Mot de passe')}
                {s.ip && <> · {s.ip}</>} · {t('ouverte le {date}', { date: dateTime(s.createdAt) })}
                {!s.current && <> · {t('active {when}', { when: relative(s.lastSeenAt) })}</>}
              </span>
            </span>
            {!s.current && (
              <button
                type="button"
                className="btn-line sm"
                onClick={() =>
                  setConfirm({
                    title: t('Fermer la session « {device} » ?', { device: s.device }),
                    body: t('Ce navigateur devra se reconnecter; ses pages ouvertes se ferment.'),
                    action: t('Fermer'),
                    run: async () => {
                      await api(`/me/sessions/${s.id}`, { method: 'DELETE' });
                      await refresh();
                    },
                  })
                }
              >
                {t('Fermer')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog confirmation={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}
