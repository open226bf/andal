import { CaretRightIcon, KeyIcon, PlusIcon, TrashIcon, WarningIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { FormError } from '../components/AuthCard';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { CopyField } from '../components/CopyField';
import { ConfirmDialog, Modal, type Confirmation } from '../components/Dialog';
import { PasswordDialog } from '../components/PasswordDialog';
import { Shelf } from '../components/Shelf';
import { api, errorMessage, useMe, useProjects, useTokens, type ApiToken } from '../lib/api';
import { MfaSection, SessionsSection } from './SecuritySections';
import { date, relative } from '../lib/format';
import { t, tx } from '../lib/i18n';

/** Votre compte: mot de passe, double authentification, sessions ouvertes, jetons d'API. */
export function AccountPage() {
  const me = useMe();
  const projects = useProjects();
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    document.title = `${t('Mon compte')} · Andal`;
  }, []);

  if (!me.data || !projects.data) return null;
  return (
    <div className="app admin-app">
      <div className="nav-wrap">
        <Shelf projects={projects.data} current="" me={me.data} />
      </div>
      <main className="main">
        <header className="band band-admin">
          <div className="band-vol">
            <span className="band-title">{t('Mon compte')}</span>
          </div>
          <nav className="crumbs" aria-label={t("Fil d'Ariane")}>
            <Link to="/">{t('Documentation')}</Link>
            <CaretRightIcon size={14} aria-hidden />
            <span aria-current="page">{me.data.user.name}</span>
          </nav>
        </header>
        <div className="page">
          <div className="admin-sheet account-sheet">
            {me.data.user.hasPassword && (
              <section className="account-section" aria-labelledby="password-title">
                <div className="admin-head">
                  <div>
                    <h2 id="password-title">{t('Mot de passe')}</h2>
                    <p className="admin-count">{t('Le changer ferme vos autres sessions.')}</p>
                  </div>
                  <button type="button" className="btn-line" onClick={() => setPasswordOpen(true)}>
                    <KeyIcon size={18} aria-hidden />
                    {t('Changer le mot de passe')}
                  </button>
                </div>
              </section>
            )}
            <section className="account-section" aria-labelledby="language-title">
              <div className="admin-head">
                <div>
                  <h2 id="language-title">{t('Langue')}</h2>
                  <p className="admin-count">{t('L’interface et vos emails, dans la langue de votre choix.')}</p>
                </div>
                <LanguageSwitch signedIn />
              </div>
            </section>
            <MfaSection />
            <SessionsSection />
            <TokensSection />
          </div>
        </div>
      </main>
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}

function TokensSection() {
  const tokens = useTokens();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me', 'tokens'] });
  const example = `curl -H "Authorization: Bearer andal_…" "${location.origin}/api/pages/<id>/content?format=markdown"`;

  return (
    <section className="account-section" aria-labelledby="tokens-title">
      <div className="admin-head">
        <div>
          <h2 id="tokens-title">{t('Jetons d’API')}</h2>
          <p className="admin-count">{t('Pour la CI, un script ou un outil: un jeton agit en votre nom, avec vos droits du moment.')}</p>
        </div>
        <button type="button" className="btn-ink" onClick={() => setCreateOpen(true)}>
          <PlusIcon size={18} aria-hidden />
          {t('Nouveau jeton')}
        </button>
      </div>
      {tokens.isError && <FormError>{errorMessage(tokens.error, t('Impossible de charger vos jetons.'))}</FormError>}
      {tokens.data && tokens.data.length > 0 && (
        <table className="roster tokens">
          <thead>
            <tr>
              <th scope="col">{t('Nom')}</th>
              <th scope="col">{t('Portée')}</th>
              <th scope="col">{t('Dernière utilisation')}</th>
              <th scope="col">{t('Expire')}</th>
              <th scope="col">
                <span className="sr-only">{t('Actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.data.map((token: ApiToken) => (
              <tr key={token.id} data-disabled={token.expired ? 'true' : undefined}>
                <td data-label={t('Nom')}>
                  <b>{token.name}</b>
                  <code className="token-prefix">{token.prefix}…</code>
                </td>
                <td data-label={t('Portée')}>{token.scope === 'write' ? t('Lecture et écriture') : t('Lecture seule')}</td>
                <td data-label={t('Dernière utilisation')} className="muted">
                  {token.lastUsedAt ? relative(token.lastUsedAt) : t('Jamais')}
                </td>
                <td data-label={t('Expire')} className="muted">
                  {token.expired ? <span className="badge-off">{t('Expiré')}</span> : token.expiresAt ? date(token.expiresAt) : t('Jamais')}
                </td>
                <td className="actions">
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={t('Révoquer le jeton {name}', { name: token.name })}
                    title={t('Révoquer')}
                    onClick={() =>
                      setConfirm({
                        title: t('Révoquer « {name} » ?', { name: token.name }),
                        body: t('Le jeton cesse aussitôt de fonctionner. Ce qui s’en sert (CI, script) recevra une erreur 401.'),
                        action: t('Révoquer'),
                        run: async () => {
                          await api(`/me/tokens/${token.id}`, { method: 'DELETE' });
                          await refresh();
                        },
                      })
                    }
                  >
                    <TrashIcon size={18} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="token-usage">
        <p>{tx('Envoyez le jeton dans l’en-tête {header}. Un jeton ne gère ni les comptes, ni le partage, ni les autres jetons.', { header: <code>Authorization</code> })}</p>
        <pre>{example}</pre>
      </div>
      <CreateToken open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} />
      <ConfirmDialog confirmation={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}

function CreateToken({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [days, setDays] = useState('90');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setToken(null);
      setName('');
      setError(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await api<ApiToken & { token: string }>('/me/tokens', { method: 'POST', body: JSON.stringify({ name, scope, expiresInDays: days ? Number(days) : null }) });
      setToken(created.token);
      await onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={close} title={token ? t('Votre nouveau jeton') : t('Nouveau jeton d’API')}>
      {token ? (
        <div className="dialog-body">
          <p className="token-once" role="note">
            <WarningIcon size={18} aria-hidden />
            {t('Copiez-le maintenant: il ne sera plus jamais affiché. Rangez-le dans le coffre de votre CI, pas dans le dépôt.')}
          </p>
          <CopyField label={t('Jeton d’API')} value={token} />
          <div className="dialog-actions">
            <Dialog.Close className="btn-ink">{t('J’ai copié le jeton')}</Dialog.Close>
          </div>
        </div>
      ) : (
        <form className="dialog-body" onSubmit={(e) => void submit(e)}>
          {error && <FormError>{error}</FormError>}
          <div className="field">
            <label htmlFor="token-name">{t('Nom')}</label>
            <input id="token-name" className="input" required autoFocus maxLength={60} placeholder={t('CI specs Paiements')} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <fieldset className="field">
            <legend>{t('Portée')}</legend>
            <label className="check">
              <input type="radio" name="scope" checked={scope === 'read'} onChange={() => setScope('read')} />
              {t('Lecture seule: lire les pages, la recherche, les specs')}
            </label>
            <label className="check">
              <input type="radio" name="scope" checked={scope === 'write'} onChange={() => setScope('write')} />
              {t('Lecture et écriture: aussi écrire les pages, publier les specs')}
            </label>
          </fieldset>
          <div className="field">
            <label htmlFor="token-days">{t('Expiration')}</label>
            <select id="token-days" className="input select" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">{t('Dans 7 jours')}</option>
              <option value="30">{t('Dans 30 jours')}</option>
              <option value="90">{t('Dans 90 jours')}</option>
              <option value="365">{t('Dans un an')}</option>
              <option value="">{t('Jamais')}</option>
            </select>
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="btn-line">{t('Annuler')}</Dialog.Close>
            <button type="submit" className="btn-ink" disabled={pending}>
              {t('Créer le jeton')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
