import { pageIdFromHref } from '@andal/editor';
import { LockSimpleIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePagePreview } from '../lib/api';
import { date } from '../lib/format';

/** Lien du texte de la page (pas les boutons des figures ni les fiches de fichiers). */
function textLink(target: EventTarget | null): HTMLAnchorElement | null {
  const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('.ProseMirror a[href]') : null;
  return anchor && !anchor.closest('[data-node-view-wrapper]') ? anchor : null;
}

const SAFE_EXTERNAL = /^(https?:|mailto:)/i;

/**
 * Les liens de la page: une page d'Andal s'ouvre dans l'application, avec un
 * aperçu au survol; un lien externe s'ouvre dans un onglet. En mode édition,
 * un clic place le curseur; ⌘ ou Ctrl + clic suit le lien.
 */
export function LinkLayer({ container, editing }: { container: RefObject<HTMLElement | null>; editing: boolean }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const overCard = useRef(false);

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const anchor = textLink(event.target);
      if (!anchor) return;
      const follow = !editing || event.metaKey || event.ctrlKey;
      event.preventDefault();
      if (!follow) return;
      const href = anchor.getAttribute('href') ?? '';
      const pageId = pageIdFromHref(href);
      if (pageId) {
        if (event.metaKey || event.ctrlKey) window.open(`/p/${pageId}`, '_blank', 'noopener');
        else void navigate({ to: '/p/$pageId', params: { pageId } });
      } else if (SAFE_EXTERNAL.test(href)) {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    };

    const show = (anchor: HTMLAnchorElement) => {
      const pageId = pageIdFromHref(anchor.getAttribute('href') ?? '');
      clearTimeout(timer.current);
      if (!pageId) return;
      timer.current = setTimeout(() => setHover({ id: pageId, rect: anchor.getBoundingClientRect() }), 350);
    };
    const hide = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!overCard.current) setHover(null);
      }, 200);
    };
    const onOver = (event: Event) => {
      const anchor = textLink(event.target);
      if (anchor) show(anchor);
    };
    const onOut = (event: Event) => {
      if (textLink(event.target)) hide();
    };

    root.addEventListener('click', onClick);
    root.addEventListener('mouseover', onOver);
    root.addEventListener('mouseout', onOut);
    root.addEventListener('focusin', onOver);
    root.addEventListener('focusout', onOut);
    return () => {
      clearTimeout(timer.current);
      root.removeEventListener('click', onClick);
      root.removeEventListener('mouseover', onOver);
      root.removeEventListener('mouseout', onOut);
      root.removeEventListener('focusin', onOver);
      root.removeEventListener('focusout', onOut);
    };
  }, [container, editing, navigate]);

  useEffect(() => {
    if (!hover) return;
    const close = () => setHover(null);
    window.addEventListener('scroll', close, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', close, { capture: true });
  }, [hover]);

  if (!hover) return null;
  return createPortal(
    <PreviewCard
      id={hover.id}
      rect={hover.rect}
      onEnter={() => {
        overCard.current = true;
        clearTimeout(timer.current);
      }}
      onLeave={() => {
        overCard.current = false;
        setHover(null);
      }}
    />,
    document.body,
  );
}

function PreviewCard({ id, rect, onEnter, onLeave }: { id: string; rect: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const preview = usePagePreview(id);
  const width = Math.min(360, window.innerWidth - 32);
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
  const below = rect.bottom + 8 + 180 < window.innerHeight;
  const style = below ? { left, top: rect.bottom + 8, width } : { left, bottom: window.innerHeight - rect.top + 8, width };
  const data = preview.data;

  return (
    <div className="pop link-preview" role="tooltip" style={style} data-vol={data?.project.cloth} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {data ? (
        <>
          <span className="link-preview-vol">
            <span className="vol-swatch" aria-hidden />
            {data.project.shortName}
          </span>
          <b className="link-preview-title">
            <span className="num">{data.number}</span> {data.title}
          </b>
          {(data.summary || data.excerpt) && <p>{data.summary || data.excerpt}</p>}
          <small>Modifiée le {date(data.updatedAt)}</small>
        </>
      ) : preview.isError ? (
        <p className="link-preview-missing">
          <LockSimpleIcon size={16} aria-hidden />
          Page introuvable, ou que vous ne lisez pas.
        </p>
      ) : (
        <span className="doc-skeleton" aria-busy="true" aria-label="Chargement de l'aperçu">
          <span />
          <span />
        </span>
      )}
    </div>
  );
}
