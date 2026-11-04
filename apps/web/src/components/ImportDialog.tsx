import { CheckCircleIcon, FileArchiveIcon, SpinnerGapIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, canEdit, errorMessage, useMe, type ImportState, type Tree } from '../lib/api';
import { fileSize } from '../lib/format';
import { t, tn } from '../lib/i18n';
import { FormError } from './AuthCard';
import { Modal } from './Dialog';

const SOURCES: Record<string, string> = { markdown: 'Markdown', notion: 'Notion', confluence: 'Confluence', html: 'HTML' };

/**
 * Importer des pages dans le volume: une archive Markdown (celle de « Exporter
 * le volume » comprise), un export Notion ou l'export HTML d'un espace
 * Confluence. Le serveur importe en tâche de fond; la fenêtre suit l'avancée.
 */
export function ImportDialog({ tree, open, onOpenChange }: { tree: Tree; open: boolean; onOpenChange: (open: boolean) => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [parent, setParent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportState | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const destinations = tree.pages.filter((p) => canEdit(p.role));
  const maxMb = me.data?.features.importMaxMb ?? 200;

  // Fenêtre rouverte: on repart de zéro.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setParent('');
    setError(null);
    setJob(null);
  }, [open]);

  // L'import tourne sur le serveur: on suit son état jusqu'au bout.
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    const timer = setTimeout(() => {
      api<ImportState>(`/imports/${job.id}`)
        .then((next) => {
          setJob(next);
          if (next.status === 'done') for (const key of ['tree', 'projects']) void queryClient.invalidateQueries({ queryKey: [key] });
        })
        .catch((err: unknown) => setError(errorMessage(err)));
    }, 900);
    return () => clearTimeout(timer);
  }, [job, queryClient]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) {
      setError(t('Archive trop lourde: {n} Mo au plus.', { n: maxMb }));
      return;
    }
    setSending(true);
    setError(null);
    const form = new FormData();
    // La destination avant le fichier: le serveur la lit au fil de l'envoi.
    if (parent) form.append('parentId', parent);
    form.append('file', file);
    try {
      setJob(await api<ImportState>(`/projects/${tree.project.id}/imports`, { method: 'POST', body: form }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const running = job && (job.status === 'pending' || job.status === 'running');

  return (
    <Modal open={open} onOpenChange={(next) => !running && onOpenChange(next)} title={t('Importer des pages dans {name}', { name: tree.project.shortName })}>
      {!job ? (
        <form className="dialog-body import-form" onSubmit={(e) => void submit(e)}>
          {error && <FormError>{error}</FormError>}
          <ul className="import-sources">
            <li>
              <b>{t('Markdown')}</b>
              {t('Un fichier .md, ou un dossier zippé: un dossier par page parente, les images à côté. L’archive d’un volume exporté d’Andal se réimporte telle quelle.')}
            </li>
            <li>
              <b>{t('Notion')}</b>
              {t('Export « Markdown & CSV », avec les sous-pages: les bases deviennent des tableaux.')}
            </li>
            <li>
              <b>{t('Confluence')}</b>
              {t('Export HTML d’un espace: arborescence, encadrés, code, tableaux, images et pièces jointes.')}
            </li>
          </ul>
          <div className="field">
            <span className="field-label">{t('Fichier')}</span>
            <button type="button" className={`import-pick${file ? ' has-file' : ''}`} onClick={() => input.current?.click()}>
              {file ? <FileArchiveIcon size={22} aria-hidden /> : <UploadSimpleIcon size={22} aria-hidden />}
              <span>
                <b>{file ? file.name : t('Choisir un fichier…')}</b>
                <small>{file ? fileSize(file.size) : t('.zip, .md ou .html, {n} Mo au plus', { n: maxMb })}</small>
              </span>
            </button>
            <input ref={input} type="file" hidden accept=".zip,.md,.markdown,.html,.htm,application/zip,text/markdown,text/html" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="field">
            <label htmlFor="import-parent">{t('Ranger les pages')}</label>
            <select id="import-parent" className="input select" value={parent} onChange={(e) => setParent(e.target.value)}>
              {canEdit(tree.project.role) && <option value="">{t('Au premier niveau du volume')}</option>}
              {destinations.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('Sous « {number} {title} »', { number: p.number, title: p.title })}
                </option>
              ))}
            </select>
          </div>
          <p className="form-hint">{t('Les pages importées prennent les droits de leur destination. Rien n’est remplacé: elles s’ajoutent à la suite.')}</p>
          <button type="submit" className="btn-ink" disabled={!file || sending || (!parent && !canEdit(tree.project.role))}>
            {sending ? t('Envoi…') : t('Importer')}
          </button>
        </form>
      ) : (
        <div className="dialog-body import-state" aria-live="polite">
          {running && (
            <p className="import-line">
              <SpinnerGapIcon size={20} className="spin" aria-hidden />
              {t('Import de {file} en cours…', { file: job.fileName })}
            </p>
          )}
          {job.status === 'done' && (
            <>
              <p className="import-line ok">
                <CheckCircleIcon size={20} weight="fill" aria-hidden />
                {tn(job.pages, '{n} page importée', '{n} pages importées')}
                {job.files > 0 && ` · ${tn(job.files, '{n} fichier', '{n} fichiers')}`}
                {job.source && ` · ${SOURCES[job.source] ?? job.source}`}
              </p>
              {job.warnings.length > 0 && (
                <details className="import-warnings">
                  <summary>{tn(job.warnings.length, '{n} remarque', '{n} remarques')}</summary>
                  <ul>
                    {job.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              {job.firstPageId && (
                <button
                  type="button"
                  className="btn-ink"
                  onClick={() => {
                    onOpenChange(false);
                    void navigate({ to: '/v/$slug/$pageId', params: { slug: tree.project.slug, pageId: job.firstPageId! } });
                  }}
                >
                  {t('Ouvrir la première page')}
                </button>
              )}
            </>
          )}
          {job.status === 'failed' && (
            <>
              <p className="import-line err">
                <WarningCircleIcon size={20} weight="fill" aria-hidden />
                {job.error ?? t('L’import a échoué.')}
              </p>
              <button type="button" className="btn-paper" onClick={() => setJob(null)}>
                {t('Choisir un autre fichier')}
              </button>
            </>
          )}
          {error && <FormError>{error}</FormError>}
        </div>
      )}
    </Modal>
  );
}
