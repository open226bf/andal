import { SparkleIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useProjects, useSearch } from '../lib/api';
import { useAskStatus } from '../lib/ask';
import { t, tx } from '../lib/i18n';
import { matchesVolume, volumeLink } from '../lib/volumes';
import { AskAnswer } from './AskAnswer';

/**
 * Recherche plein texte. L'API ne renvoie que les pages que vous pouvez lire;
 * les volumes se trouvent par leur nom. Si l'assistant est activé, une
 * question (« … ? », ou Maj+Entrée) obtient une réponse rédigée et sourcée.
 */
export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useSearch(debounced);
  const projects = useProjects();
  const volumes = q.trim() ? (projects.data ?? []).filter((v) => matchesVolume(v, q)).slice(0, 4) : [];
  const assistant = useAskStatus();
  const [asked, setAsked] = useState<string | null>(null);
  const canAsk = Boolean(assistant.data?.enabled) && q.trim().length >= 3;
  useEffect(() => {
    if (!open) setAsked(null);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="pop search-dialog" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{t('Rechercher dans la documentation')}</Dialog.Title>
          {asked ? (
            <AskAnswer question={asked} model={assistant.data?.model ?? null} onBack={() => setAsked(null)} onOpen={() => onOpenChange(false)} />
          ) : (
            <>
              <input
                className="search-input"
                autoFocus
                placeholder={assistant.data?.enabled ? t('Rechercher, ou poser une question…') : t('Rechercher une page, un endpoint, une figure…')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  // Une question (« … ? ») ou Maj+Entrée va à l'assistant.
                  if (e.key === 'Enter' && canAsk && (e.shiftKey || q.trim().endsWith('?'))) {
                    e.preventDefault();
                    setAsked(q.trim());
                  }
                }}
                aria-label={t('Recherche')}
              />
              {(volumes.length > 0 || debounced.trim().length > 1 || canAsk) && (
                <ul className="search-results" aria-busy={isFetching}>
                  {canAsk && (
                    <li>
                      <button type="button" className="search-ask" onClick={() => setAsked(q.trim())}>
                        <SparkleIcon size={18} aria-hidden />
                        <span>{tx('Demander à l’assistant: {question}', { question: <b>{q.trim()}</b> })}</span>
                        <kbd>{q.trim().endsWith('?') ? '↵' : '⇧↵'}</kbd>
                      </button>
                    </li>
                  )}
                  {volumes.map((v) => (
                    <li key={v.id}>
                      <Link {...volumeLink(v)} onClick={() => onOpenChange(false)} data-vol={v.cloth} className="search-volume">
                        <span className="vol-swatch" aria-hidden />
                        <span>
                          {v.name} <small className="text-ink-3">· {t('Volume {n}', { n: v.volumeNumber })}</small>
                        </span>
                        {v.description && <span className="snippet">{v.description}</span>}
                      </Link>
                    </li>
                  ))}
                  {debounced.trim().length > 1 && data?.length === 0 && <li className="search-empty">{t('Aucune page lisible ne correspond.')}</li>}
                  {debounced.trim().length > 1 && data?.map((hit) => (
                    <li key={hit.id}>
                      <Link to="/v/$slug/$pageId" params={{ slug: hit.project.slug, pageId: hit.id }} onClick={() => onOpenChange(false)} data-vol={hit.project.cloth}>
                        <span className="num">{hit.number}</span>
                        <span>
                          {hit.title} <small className="text-ink-3">· {hit.project.shortName}</small>
                        </span>
                        <span className="snippet">{hit.snippet}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
