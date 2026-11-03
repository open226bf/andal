import { ArrowsClockwiseIcon, GitBranchIcon, LinkBreakIcon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { relative } from '../lib/format';
import { t, tn, tx } from '../lib/i18n';
import { FormError, FormOk } from './AuthCard';
import { CopyField } from './CopyField';

type GitState =
  | { configured: false }
  | {
      configured: true;
      repoUrl: string;
      branch: string;
      path: string;
      hasToken: boolean;
      enabled: boolean;
      lastCommit: string | null;
      lastSyncedAt: string | null;
      lastError: string | null;
      pageCount: number;
      webhookUrl: string;
      webhookSecret: string;
    };

/**
 * Synchro Git du volume (docs-as-code): un dossier d'un dépôt devient une
 * branche du sommaire, tenue par le dépôt. Dans les réglages du volume.
 */
export function GitSyncPanel({ projectId, slug }: { projectId: string; slug: string }) {
  const queryClient = useQueryClient();
  const git = useQuery({ queryKey: ['git', projectId], queryFn: () => api<GitState>(`/projects/${projectId}/git`), refetchInterval: (q) => (q.state.data?.configured && !q.state.data.lastSyncedAt ? 2000 : false) });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ repoUrl: '', branch: 'main', path: 'docs', token: '' });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['git', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['tree', slug] });
  };

  const act = async (run: () => Promise<unknown>, done?: string) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await run();
      await refresh();
      if (done) setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await api(`/projects/${projectId}/git`, { method: 'PUT', body: JSON.stringify({ repoUrl: form.repoUrl, branch: form.branch, path: form.path, ...(form.token ? { token: form.token } : {}) }) });
      setEditing(false);
    }, t('Dépôt relié: la première synchro est en cours.'));
  };

  const state = git.data;
  return (
    <section className="dialog-body git-panel" aria-labelledby="git-title">
      <h3 id="git-title">
        <GitBranchIcon size={18} aria-hidden />
        {t('Synchro Git')}
      </h3>
      {error && <FormError>{error}</FormError>}
      {notice && <FormOk>{notice}</FormOk>}
      {state?.configured && !editing ? (
        <>
          <p className="dialog-text">
            {tx(
              tn(
                state.pageCount,
                'Le dossier {path} de {repo} ({branch}) tient {n} page de ce volume. Elle se lit et se commente ici, et s’écrit dans le dépôt.',
                'Le dossier {path} de {repo} ({branch}) tient {n} pages de ce volume. Elles se lisent et se commentent ici, et s’écrivent dans le dépôt.',
              ),
              { path: <code>{state.path || '/'}</code>, repo: <code>{state.repoUrl.replace(/^\w+:\/\//, '')}</code>, branch: state.branch },
            )}
          </p>
          <p className={`git-state ${state.lastError ? 'err' : 'ok'}`}>
            {state.lastError
              ? t('Dernière synchro en échec: {error}', { error: state.lastError })
              : state.lastSyncedAt
                ? state.lastCommit
                  ? t('Synchronisé {when}, commit {commit}.', { when: relative(state.lastSyncedAt), commit: state.lastCommit.slice(0, 7) })
                  : t('Synchronisé {when}.', { when: relative(state.lastSyncedAt) })
                : t('Première synchro en cours…')}
          </p>
          <details className="git-hook">
            <summary>{t('Synchroniser à chaque push (webhook)')}</summary>
            <p className="field-help">{t('Dans la forge, ajoutez un webhook « push » en JSON vers cette adresse, avec ce secret (GitHub, GitLab, Gitea, Forgejo). Sans webhook, la synchro passe toutes les 10 minutes.')}</p>
            <CopyField label={t('Adresse du webhook')} value={state.webhookUrl} />
            <CopyField label={t('Secret du webhook')} value={state.webhookSecret} />
          </details>
          <div className="dialog-actions git-actions">
            <button type="button" className="ghost danger" disabled={pending} onClick={() => void act(() => api(`/projects/${projectId}/git`, { method: 'DELETE' }), t('Volume détaché du dépôt: ses pages restent, et redeviennent modifiables ici.'))}>
              <LinkBreakIcon size={16} aria-hidden />
              {t('Détacher')}
            </button>
            <button
              type="button"
              className="btn-line"
              onClick={() => {
                setForm({ repoUrl: state.repoUrl, branch: state.branch, path: state.path, token: '' });
                setEditing(true);
              }}
            >
              {t('Modifier')}
            </button>
            <button type="button" className="btn-ink" disabled={pending} onClick={() => void act(() => api(`/projects/${projectId}/git/sync`, { method: 'POST' }), t('Synchro demandée.'))}>
              <ArrowsClockwiseIcon size={16} aria-hidden />
              {t('Synchroniser')}
            </button>
          </div>
        </>
      ) : editing ? (
        <form className="git-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="git-url">{t('Dépôt')}</label>
            <input id="git-url" className="input" required placeholder="https://github.com/equipe/docs.git" value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} />
          </div>
          <div className="git-row">
            <div className="field">
              <label htmlFor="git-branch">{t('Branche')}</label>
              <input id="git-branch" className="input" required value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="git-path">{t('Dossier')}</label>
              <input id="git-path" className="input" placeholder={t('docs (vide: la racine)')} value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="git-token">{t('Jeton d’accès en lecture (dépôt privé)')}</label>
            <input id="git-token" className="input" type="password" autoComplete="off" placeholder={state?.configured && state.hasToken ? t('Inchangé') : t('Facultatif')} value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
            <p className="field-help">{t('Chaque fichier Markdown devient une page, chaque sous-dossier une page parente (son README.md en est le contenu). Liens relatifs, images et blocs ```mermaid et ```openapi suivent.')}</p>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn-line" onClick={() => setEditing(false)}>
              {t('Annuler')}
            </button>
            <button type="submit" className="btn-ink" disabled={pending}>
              {state?.configured ? t('Enregistrer') : t('Relier le dépôt')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="dialog-text">{t('Écrivez la documentation dans un dépôt, à côté du code: un dossier de fichiers Markdown devient une branche de ce volume, mise à jour à chaque push.')}</p>
          <button type="button" className="btn-line git-start" onClick={() => setEditing(true)}>
            {t('Relier un dépôt…')}
          </button>
        </>
      )}
    </section>
  );
}
