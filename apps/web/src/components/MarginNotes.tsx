import { Avatar } from '@andal/ui';
import { ArrowCounterClockwiseIcon, CheckIcon, TrashIcon } from '@phosphor-icons/react';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { api, errorMessage, type Posted, type Thread, type ThreadComment } from '../lib/api';
import { relative } from '../lib/format';
import { t } from '../lib/i18n';
import { FormError, FormOk } from './AuthCard';
import { CommentBody, MentionTextarea, unreachableNotice } from './Mentions';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Commentaires dans la marge, alignés sur leur ancre dans le texte.
 * Sous 956 px de large, ils passent sous la page (voir app.css).
 * Les fils résolus, et ceux dont le passage a disparu, sont rangés en fin de page.
 */
export function MarginNotes({
  threads,
  editor,
  container,
  pageId,
  focus,
  onChanged,
}: {
  threads: Thread[];
  editor: Editor | null;
  container: RefObject<HTMLDivElement | null>;
  pageId: string;
  /** Fil à montrer en arrivant (lien d'une notification). */
  focus?: string;
  onChanged: () => void;
}) {
  const [tops, setTops] = useState<Record<string, number>>({});
  const notesRef = useRef<HTMLDivElement>(null);
  const open = threads.filter((t) => !t.resolvedAt);

  const place = useCallback(() => {
    const root = container.current;
    if (!root) return;
    const base = root.getBoundingClientRect().top;
    const next: Record<string, number> = {};
    let floor = 0;
    const anchored = open
      .map((t) => ({ id: t.id, el: root.querySelector<HTMLElement>(`.ProseMirror [data-thread="${CSS.escape(t.id)}"]`) }))
      .filter((a): a is { id: string; el: HTMLElement } => a.el !== null)
      .map((a) => ({ id: a.id, top: a.el.getBoundingClientRect().top - base }))
      .sort((a, b) => a.top - b.top);
    for (const a of anchored) {
      const top = Math.round(Math.max(a.top - 10, floor));
      next[a.id] = top;
      const height = notesRef.current?.querySelector<HTMLElement>(`[data-note="${CSS.escape(a.id)}"]`)?.offsetHeight ?? 120;
      floor = top + height + 16;
    }
    setTops((prev) => (sameTops(prev, next) ? prev : next));
    // `open` est recalculé à chaque rendu: ses identifiants suffisent comme dépendance.
  }, [open.map((t) => t.id).join(','), container]);

  // Après chaque rendu: la hauteur réelle des notes n'est connue qu'une fois affichées.
  // La comparaison dans place() arrête la boucle dès que les positions sont stables.
  useLayoutEffect(place);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root || !editor) return;
    const observer = new ResizeObserver(place);
    observer.observe(root);
    // Une note qui grandit (réponse en cours) repousse celles du dessous.
    notesRef.current?.querySelectorAll('.side').forEach((note) => observer.observe(note));
    editor.on('update', place);
    return () => {
      observer.disconnect();
      editor.off('update', place);
    };
  }, [place, editor, container, tops]);

  const anchored = open.filter((t) => tops[t.id] !== undefined);
  const detached = editor ? open.filter((t) => tops[t.id] === undefined) : [];
  const resolved = threads.filter((t) => t.resolvedAt);
  const focusResolved = resolved.some((t) => t.id === focus);

  // Arrivée par une notification: amener le fil à l'écran et le signaler, une seule fois.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || !editor || shown.current === focus || !threads.some((t) => t.id === focus)) return;
    const frame = requestAnimationFrame(() => {
      const note = [...document.querySelectorAll<HTMLElement>(`[data-thread-note="${CSS.escape(focus)}"]`)].find((el) => el.offsetParent !== null);
      if (!note) return;
      shown.current = focus;
      const anchor = document.querySelector<HTMLElement>(`.ProseMirror [data-thread="${CSS.escape(focus)}"]`);
      (anchor && !focusResolved ? anchor : note).scrollIntoView({ block: 'center', behavior: 'smooth' });
      note.classList.add('flash');
      window.setTimeout(() => note.classList.remove('flash'), 2400);
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, editor, threads, tops, focusResolved]);

  return (
    <>
      <AnchorHighlights threads={open} />
      {anchored.length > 0 && (
        <>
          <div className="notes" ref={notesRef} aria-label={t('Commentaires')}>
            {anchored.map((t) => (
              <Note key={t.id} thread={t} top={tops[t.id]} pageId={pageId} onChanged={onChanged} />
            ))}
          </div>
          <div className="notes-inline after" aria-label={t('Commentaires')}>
            {anchored.map((t) => (
              <Note key={t.id} thread={t} pageId={pageId} onChanged={onChanged} />
            ))}
          </div>
        </>
      )}
      {(detached.length > 0 || resolved.length > 0) && (
        <section className="threads-archive" aria-label={t('Autres commentaires')}>
          {detached.length > 0 && (
            <details open>
              <summary>{t('Sans passage ({n})', { n: detached.length })}</summary>
              <p className="muted">{t('Le texte commenté a été supprimé. Répondez, ou résolvez le fil.')}</p>
              {detached.map((t) => (
                <Note key={t.id} thread={t} pageId={pageId} onChanged={onChanged} />
              ))}
            </details>
          )}
          {resolved.length > 0 && (
            <details open={focusResolved || undefined}>
              <summary>{t('Fils résolus ({n})', { n: resolved.length })}</summary>
              {resolved.map((t) => (
                <Note key={t.id} thread={t} pageId={pageId} onChanged={onChanged} />
              ))}
            </details>
          )}
        </section>
      )}
    </>
  );
}

/**
 * Seuls les passages des fils ouverts sont surlignés: un fil résolu ou supprimé
 * ne laisse pas de trace visible. L'aperçu d'une ancienne version n'en a pas.
 */
function AnchorHighlights({ threads }: { threads: Thread[] }) {
  const ids = threads.map((t) => t.id).filter((id) => UUID.test(id));
  if (ids.length === 0) return null;
  const selector = ids.map((id) => `.ProseMirror:not(.history-doc *) [data-thread="${id}"]`).join(',\n');
  return <style>{`${selector} { background: var(--hl); color: var(--hl-ink, inherit); text-decoration: underline 2px var(--hl-line); text-underline-offset: 4px; padding: 0 .1em; }`}</style>;
}

function sameTops(a: Record<string, number>, b: Record<string, number>) {
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((k) => a[k] === b[k]);
}

function Note({ thread, top, pageId, onChanged }: { thread: Thread; top?: number; pageId: string; onChanged: () => void }) {
  const [hover, setHover] = useState(false);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const resolved = thread.resolvedAt !== null;

  useEffect(() => {
    document.querySelectorAll(`[data-thread="${CSS.escape(thread.id)}"]`).forEach((el) => el.classList.toggle('active', hover));
  }, [hover, thread.id]);

  const run = async (call: () => Promise<unknown>) => {
    setError(null);
    try {
      await call();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const [first, ...replies] = thread.comments;
  if (!first) return null;
  return (
    <aside
      className={`side${hover ? ' active' : ''}`}
      data-note={top !== undefined ? thread.id : undefined}
      data-thread-note={thread.id}
      style={top !== undefined ? { top } : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Comment comment={first} onDelete={() => run(() => api(`/comments/${first.id}`, { method: 'DELETE' }))}>
        {thread.canReply &&
          (resolved ? (
            <button type="button" className="icon-btn xs" title={t('Rouvrir le fil')} aria-label={t('Rouvrir le fil')} onClick={() => void run(() => api(`/threads/${thread.id}/reopen`, { method: 'POST' }))}>
              <ArrowCounterClockwiseIcon size={16} aria-hidden />
            </button>
          ) : (
            <button type="button" className="icon-btn xs" title={t('Résoudre le fil')} aria-label={t('Résoudre le fil')} onClick={() => void run(() => api(`/threads/${thread.id}/resolve`, { method: 'POST' }))}>
              <CheckIcon size={16} aria-hidden />
            </button>
          ))}
      </Comment>
      {replies.map((c) => (
        <div className="reply" key={c.id}>
          <Comment comment={c} small onDelete={() => run(() => api(`/comments/${c.id}`, { method: 'DELETE' }))} />
        </div>
      ))}
      {resolved && thread.resolvedBy && <p className="resolved-by">{t('Résolu par {name}', { name: thread.resolvedBy })}</p>}
      {error && <FormError>{error}</FormError>}
      {notice && <FormOk>{notice}</FormOk>}
      {thread.canReply &&
        !resolved &&
        (replying ? (
          <ReplyForm
            pageId={pageId}
            onCancel={() => setReplying(false)}
            onSubmit={async (body) => {
              const posted = await api<Posted>(`/threads/${thread.id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
              setNotice(unreachableNotice(posted.unreachable));
              setReplying(false);
              onChanged();
            }}
          />
        ) : (
          <button
            type="button"
            className="ghost note-reply"
            onClick={() => {
              setNotice(null);
              setReplying(true);
            }}
          >
            {t('Répondre')}
          </button>
        ))}
    </aside>
  );
}

function Comment({ comment, small, onDelete, children }: { comment: ThreadComment; small?: boolean; onDelete: () => Promise<void>; children?: React.ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div className="who">
        <Avatar initials={comment.author.initials} color={comment.author.color} size={small ? 22 : 24} />
        <span className="name">{comment.author.name}</span>
        <time dateTime={comment.createdAt}>{relative(comment.createdAt)}</time>
        <span className="note-tools">
          {comment.canDelete &&
            (confirming ? (
              <>
                <button type="button" className="ghost danger xs" onClick={() => void onDelete()} autoFocus>
                  {t('Supprimer')}
                </button>
                <button type="button" className="ghost xs" onClick={() => setConfirming(false)}>
                  {t('Non')}
                </button>
              </>
            ) : (
              <button type="button" className="icon-btn xs" title={t('Supprimer')} aria-label={t('Supprimer ce commentaire')} onClick={() => setConfirming(true)}>
                <TrashIcon size={15} aria-hidden />
              </button>
            ))}
          {!confirming && children}
        </span>
      </div>
      <CommentBody comment={comment} />
    </>
  );
}

function ReplyForm({ pageId, onSubmit, onCancel }: { pageId: string; onSubmit: (body: string) => Promise<void>; onCancel: () => void }) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!body.trim()) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') onCancel();
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
  };

  return (
    <form className="note-form" onSubmit={(e) => void submit(e)}>
      {error && <FormError>{error}</FormError>}
      <MentionTextarea pageId={pageId} aria-label={t('Votre réponse')} autoFocus required maxLength={4000} value={body} onValueChange={setBody} onKeyDown={onKeyDown} placeholder={t('Votre réponse, @ pour citer')} />
      <div className="note-form-actions">
        <button type="button" className="btn-line sm" onClick={onCancel}>
          {t('Annuler')}
        </button>
        <button type="submit" className="btn-ink sm" disabled={pending || !body.trim()}>
          {pending ? t('Envoi…') : t('Répondre')}
        </button>
      </div>
    </form>
  );
}
