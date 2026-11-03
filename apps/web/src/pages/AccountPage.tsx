import { CaretRightIcon, KeyIcon, PlusIcon, TrashIcon, WarningIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { FormError } from '../components/AuthCard';
import { CopyField } from '../components/CopyField';
import { ConfirmDialog, Modal, type Confirmation } from '../components/Dialog';
import { PasswordDialog } from '../components/PasswordDialog';
import { Shelf } from '../components/Shelf';
import { api, errorMessage, useMe, useProjects, useTokens, type ApiToken } from '../lib/api';
import { date, relative } from '../lib/format';

/** Votre compte: mot de passe et jetons d'API (les sections de sécurité s'y ajoutent). */
export function AccountPage() {
  const me = useMe();
  const projects = useProjects();
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    document.title = 'Mon compte · Andal';
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
            <span className="band-title">Mon compte</span>
          </div>
          <nav className="crumbs" aria-label="Fil d'Ariane">
            <Link to="/">Documentation</Link>
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
                    <h2 id="password-title">Mot de passe</h2>
                    <p className="admin-count">Le changer ferme vos autres sessions.</p>
                  </div>
                  <button type="button" className="btn-line" onClick={() => setPasswordOpen(true)}>
                    <KeyIcon size={18} aria-hidden />
                    Changer le mot de passe
                  </button>
                </div>
              </section>
            )}
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
          <h2 id="tokens-title">Jetons d’API</h2>
          <p className="admin-count">Pour la CI, un script ou un outil: un jeton agit en votre nom, avec vos droits du moment.</p>
        </div>
        <button type="button" className="btn-ink" onClick={() => setCreateOpen(true)}>
          <PlusIcon size={18} aria-hidden />
          Nouveau jeton
        </button>
      </div>
      {tokens.isError && <FormError>{errorMessage(tokens.error, 'Impossible de charger vos jetons.')}</FormError>}
      {tokens.data && tokens.data.length > 0 && (
        <table className="roster tokens">
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Portée</th>
              <th scope="col">Dernière utilisation</th>
              <th scope="col">Expire</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.data.map((t: ApiToken) => (
              <tr key={t.id} data-disabled={t.expired ? 'true' : undefined}>
                <td data-label="Nom">
                  <b>{t.name}</b>
                  <code className="token-prefix">{t.prefix}…</code>
                </td>
                <td data-label="Portée">{t.scope === 'write' ? 'Lecture et écriture' : 'Lecture seule'}</td>
                <td data-label="Dernière utilisation" className="muted">
                  {t.lastUsedAt ? relative(t.lastUsedAt) : 'Jamais'}
                </td>
                <td data-label="Expire" className="muted">
                  {t.expired ? <span className="badge-off">Expiré</span> : t.expiresAt ? date(t.expiresAt) : 'Jamais'}
                </td>
                <td className="actions">
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={`Révoquer le jeton ${t.name}`}
                    title="Révoquer"
                    onClick={() =>
                      setConfirm({
                        title: `Révoquer « ${t.name} » ?`,
                        body: 'Le jeton cesse aussitôt de fonctionner. Ce qui s’en sert (CI, script) recevra une erreur 401.',
                        action: 'Révoquer',
                        run: async () => {
                          await api(`/me/tokens/${t.id}`, { method: 'DELETE' });
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
        <p>
          Envoyez le jeton dans l’en-tête <code>Authorization</code>. Un jeton ne gère ni les comptes, ni le partage, ni les autres jetons.
        </p>
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
    <Modal open={open} onOpenChange={close} title={token ? 'Votre nouveau jeton' : 'Nouveau jeton d’API'}>
      {token ? (
        <div className="dialog-body">
          <p className="token-once" role="note">
            <WarningIcon size={18} aria-hidden />
            Copiez-le maintenant: il ne sera plus jamais affiché. Rangez-le dans le coffre de votre CI, pas dans le dépôt.
          </p>
          <CopyField label="Jeton d’API" value={token} />
          <div className="dialog-actions">
            <Dialog.Close className="btn-ink">J’ai copié le jeton</Dialog.Close>
          </div>
        </div>
      ) : (
        <form className="dialog-body" onSubmit={(e) => void submit(e)}>
          {error && <FormError>{error}</FormError>}
          <div className="field">
            <label htmlFor="token-name">Nom</label>
            <input id="token-name" className="input" required autoFocus maxLength={60} placeholder="CI specs Paiements" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <fieldset className="field">
            <legend>Portée</legend>
            <label className="check">
              <input type="radio" name="scope" checked={scope === 'read'} onChange={() => setScope('read')} />
              Lecture seule: lire les pages, la recherche, les specs
            </label>
            <label className="check">
              <input type="radio" name="scope" checked={scope === 'write'} onChange={() => setScope('write')} />
              Lecture et écriture: aussi écrire les pages, publier les specs
            </label>
          </fieldset>
          <div className="field">
            <label htmlFor="token-days">Expiration</label>
            <select id="token-days" className="input select" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">Dans 7 jours</option>
              <option value="30">Dans 30 jours</option>
              <option value="90">Dans 90 jours</option>
              <option value="365">Dans un an</option>
              <option value="">Jamais</option>
            </select>
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="btn-line">Annuler</Dialog.Close>
            <button type="submit" className="btn-ink" disabled={pending}>
              Créer le jeton
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
