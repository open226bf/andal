import { Avatar } from '@andal/ui';
import { ArrowCounterClockwiseIcon, XIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@andal/editor';
import { useState } from 'react';
import { readExtensions } from '../editor/extensions';
import { api, canEdit, errorMessage, useVersion, useVersions, type PageDetail, type VersionAuthor } from '../lib/api';
import { DocContext, type DocContextValue } from '../lib/doc-context';
import { dateTime, relative } from '../lib/format';
import { t, tn } from '../lib/i18n';
import { FormError } from './AuthCard';

/**
 * L'historique d'une page: ses versions (une par séance de travail) à gauche,
 * la version choisie à droite, telle qu'elle était. Qui peut écrire la restaure.
 */
export function HistoryDialog({ page, open, onOpenChange, context }: { page: PageDetail; open: boolean; onOpenChange: (open: boolean) => void; context: DocContextValue }) {
  const versions = useVersions(page.id, open);
  const [selected, setSelected] = useState<number | null>(null);
  const shown = selected ?? versions.data?.[0]?.version ?? null;
  const detail = useVersion(page.id, open ? shown : null);
  const summary = versions.data?.find((v) => v.version === shown);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setSelected(null);
      setConfirming(false);
      setError(null);
    }
  };

  const restore = async () => {
    if (shown === null) return;
    setPending(true);
    setError(null);
    try {
      await api(`/pages/${page.id}/versions/${shown}/restore`, { method: 'POST' });
      await Promise.all(['page', 'tree', 'versions'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      close(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="pop dialog history" aria-describedby={undefined}>
          <div className="pop-head">
            <Dialog.Title asChild>
              <h2>{t('Historique de « {number} {title} »', { number: page.number, title: page.title })}</h2>
            </Dialog.Title>
            <Dialog.Close className="icon-btn sm" aria-label={t('Fermer')}>
              <XIcon size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="history-body">
            <ol className="history-list" aria-label={t('Versions')} aria-busy={versions.isPending}>
              {versions.data?.map((v) => (
                <li key={v.version}>
                  <button
                    type="button"
                    aria-current={v.version === shown ? 'true' : undefined}
                    onClick={() => {
                      setSelected(v.version);
                      setConfirming(false);
                      setError(null);
                    }}
                  >
                    <span className="history-num">
                      v{v.version}
                      {v.current && <span className="you">{t('actuelle')}</span>}
                    </span>
                    <span className="history-when" title={dateTime(v.updatedAt)}>
                      {relative(v.updatedAt)}
                    </span>
                    <Authors authors={v.authors} />
                  </button>
                </li>
              ))}
            </ol>
            <section className="history-preview" aria-label={shown !== null ? t('Version {n}', { n: shown }) : t('Version')}>
              {summary && (
                <header className="history-head">
                  <div>
                    <b>
                      v{summary.version}
                      {summary.title !== page.title && ` · ${t('« {title} »', { title: summary.title })}`}
                    </b>
                    <small>
                      {dateTime(summary.createdAt)}
                      {summary.updatedAt !== summary.createdAt && ` → ${dateTime(summary.updatedAt)}`}
                      {summary.authors.length > 0 && ` · ${summary.authors.map((a) => a.name).join(', ')}`}
                    </small>
                  </div>
                  {canEdit(page.role) &&
                    !summary.current &&
                    (confirming ? (
                      <span className="history-confirm">
                        <button type="button" className="btn-line sm" onClick={() => setConfirming(false)}>
                          {t('Annuler')}
                        </button>
                        <button type="button" className="btn-ink sm" disabled={pending} onClick={() => void restore()}>
                          {pending ? t('Restauration…') : t('Oui, revenir à la v{version}', { version: summary.version })}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn-line sm" onClick={() => setConfirming(true)}>
                        <ArrowCounterClockwiseIcon size={16} aria-hidden />
                        {t('Restaurer cette version')}
                      </button>
                    ))}
                </header>
              )}
              {confirming && <p className="history-note">{t('La page reprend ce contenu pour tout le monde, pages ouvertes comprises. Rien n’est perdu : la version actuelle reste dans l’historique.')}</p>}
              {error && <FormError>{error}</FormError>}
              {detail.data ? (
                <DocContext.Provider value={{ ...context, editing: false }}>
                  <VersionContent key={detail.data.version} content={detail.data.content} />
                </DocContext.Provider>
              ) : (
                <div className="doc-skeleton" aria-busy="true" aria-label={t('Chargement de la version')}>
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Authors({ authors }: { authors: VersionAuthor[] }) {
  if (authors.length === 0) return <span className="history-authors muted">—</span>;
  return (
    <span className="history-authors">
      {authors.slice(0, 3).map((a) => (
        <Avatar key={a.id} initials={a.initials} color={a.color} size={20} title={a.name} />
      ))}
      <span>{authors.length === 1 ? authors[0]!.name : tn(authors.length - 1, '{name} et {n} autre', '{name} et {n} autres', { name: authors[0]!.name })}</span>
    </span>
  );
}

/** Une version telle qu'elle était, rendue comme la page, sans pouvoir la modifier. */
function VersionContent({ content }: { content: JSONContent }) {
  const editor = useEditor({ extensions: readExtensions(), content, editable: false, immediatelyRender: true }, [content]);
  return <EditorContent editor={editor} className="history-doc" />;
}
