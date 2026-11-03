import { ChatCircleTextIcon } from '@phosphor-icons/react';
import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { commentableSelection, relativeAnchor, type CommentTarget } from '../editor/anchors';
import { api, errorMessage, type Posted } from '../lib/api';
import { t } from '../lib/i18n';
import { FormError, FormOk } from './AuthCard';
import { MentionTextarea, unreachableNotice } from './Mentions';

interface Draft {
  target: CommentTarget;
  anchor: { from: string; to: string };
  top: number;
  below: number;
}

const DRAFT_HIGHLIGHT = 'andal-draft';

/**
 * Sélectionner un passage fait apparaître « Commenter »; le fil s'écrit dans
 * la marge, à hauteur du passage. Le serveur pose l'ancre: un commentateur
 * n'a pas besoin du droit d'écriture sur la page.
 */
export function CommentComposer({ editor, pageId, container, onCreated }: { editor: Editor; pageId: string; container: RefObject<HTMLDivElement | null>; onCreated: () => void }) {
  const [candidate, setCandidate] = useState<CommentTarget | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Publié, mais certaines personnes citées ne lisent pas la page: on le dit avant de refermer. */
  const [notice, setNotice] = useState<{ text: string; top: number } | null>(null);
  const drafting = useRef(false);
  drafting.current = draft !== null;

  useEffect(() => {
    const update = () => {
      if (!drafting.current) setCandidate(commentableSelection(editor));
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [editor]);

  // Le passage reste surligné pendant la saisie, même quand la sélection passe au champ.
  useEffect(() => {
    if (!draft || typeof Highlight === 'undefined' || !CSS.highlights) return;
    CSS.highlights.set(DRAFT_HIGHLIGHT, new Highlight(draft.target.range));
    return () => {
      CSS.highlights.delete(DRAFT_HIGHLIGHT);
    };
  }, [draft]);

  const box = container.current?.getBoundingClientRect();
  if (!box) return null;

  const start = () => {
    if (!candidate) return;
    // Sans liaison Yjs (document pas encore synchronisé), pas d'ancre possible: le bouton reste là.
    const anchor = relativeAnchor(editor, candidate.from, candidate.to);
    if (!anchor) return;
    setNotice(null);
    setDraft({ target: candidate, anchor, top: candidate.rect.top - box.top, below: candidate.rect.bottom - box.top + 10 });
    setCandidate(null);
    setBody('');
    setError(null);
    window.getSelection()?.removeAllRanges();
  };

  const cancel = () => {
    setDraft(null);
    setError(null);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft || !body.trim()) return;
    setPending(true);
    setError(null);
    try {
      const posted = await api<Posted>(`/pages/${pageId}/threads`, { method: 'POST', body: JSON.stringify({ body, anchor: draft.anchor }) });
      const warning = unreachableNotice(posted.unreachable);
      if (warning) setNotice({ text: t('Commentaire publié. {warning}', { warning }), top: draft.top });
      setDraft(null);
      onCreated();
    } catch (err) {
      setError(errorMessage(err, t('Le commentaire n’a pas pu être enregistré. Réessayez.')));
    } finally {
      setPending(false);
    }
  };

  if (notice && !draft) {
    return (
      <div className="composer" role="status" style={{ '--top': `${notice.top}px`, '--below': `${notice.top + 24}px` } as CSSProperties}>
        <FormOk>{notice.text}</FormOk>
        <div className="note-form-actions">
          <button type="button" className="btn-line sm" autoFocus onClick={() => setNotice(null)}>
            {t('Compris')}
          </button>
        </div>
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') cancel();
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
  };

  if (draft) {
    return (
      <form className="composer" style={{ '--top': `${draft.top}px`, '--below': `${draft.below}px` } as CSSProperties} onSubmit={(e) => void submit(e)} aria-label={t('Nouveau commentaire')}>
        <blockquote>{draft.target.text}</blockquote>
        {error && <FormError>{error}</FormError>}
        <MentionTextarea pageId={pageId} aria-label={t('Votre commentaire')} autoFocus required maxLength={4000} value={body} onValueChange={setBody} onKeyDown={onKeyDown} placeholder={t('Votre commentaire, @ pour citer')} />
        <div className="note-form-actions">
          <span className="form-hint">{t('⌘ Entrée pour envoyer')}</span>
          <button type="button" className="btn-line sm" onClick={cancel}>
            {t('Annuler')}
          </button>
          <button type="submit" className="btn-ink sm" disabled={pending || !body.trim()}>
            {pending ? t('Envoi…') : t('Commenter')}
          </button>
        </div>
      </form>
    );
  }

  if (!candidate) return null;
  // Avec une marge (même seuil que app.css), le bouton s'y place, à hauteur du passage: là où le fil s'affichera.
  const margin = (container.current?.closest('.main')?.clientWidth ?? 0) >= 956;
  const position = margin
    ? { top: candidate.rect.top - box.top - 4, left: box.width + 28 }
    : { top: candidate.rect.top - box.top - 42, left: Math.max(0, Math.min(candidate.rect.right - box.left - 60, box.width - 130)) };
  return (
    <button
      type="button"
      className="comment-fab"
      style={position}
      // Garder la sélection: sans cela, le clic l'efface avant de la lire.
      onMouseDown={(e) => e.preventDefault()}
      onClick={start}
    >
      <ChatCircleTextIcon size={16} aria-hidden />
      {t('Commenter')}
    </button>
  );
}
