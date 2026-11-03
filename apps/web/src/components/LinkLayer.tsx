import { pageIdFromHref } from '@andal/editor';
import { GitPullRequestIcon, KanbanIcon, LockSimpleIcon, RecordIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePagePreview, useUnfurl, type Unfurl } from '../lib/api';
import { date } from '../lib/format';

/** Lien du texte de la page (pas les boutons des figures ni les fiches de fichiers). */
function textLink(target: EventTarget | null): HTMLAnchorElement | null {
  const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('.ProseMirror a[href]') : null;
  return anchor && !anchor.closest('[data-node-view-wrapper]') ? anchor : null;
}

const SAFE_EXTERNAL = /^(https?:|mailto:)/i;
/** Liens qui ont un aperçu: tickets et pull requests GitHub, tickets Jira. Le serveur décide du reste. */
const UNFURLABLE = /^https:\/\/(github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+|[^/]+\/browse\/[A-Z][A-Z0-9_]+-\d+)/;

type Hover = { kind: 'page'; id: string; rect: DOMRect } | { kind: 'external'; url: string; rect: DOMRect };

/**
 * Les liens de la page: une page d'Andal s'ouvre dans l'application, avec un
 * aperçu au survol; un lien externe s'ouvre dans un onglet. En mode édition,
 * un clic place le curseur; ⌘ ou Ctrl + clic suit le lien.
 */
export function LinkLayer({ container, editing }: { container: RefObject<HTMLElement | null>; editing: boolean }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<Hover | null>(null);
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
      const href = anchor.getAttribute('href') ?? '';
      const pageId = pageIdFromHref(href);
      clearTimeout(timer.current);
      if (pageId) timer.current = setTimeout(() => setHover({ kind: 'page', id: pageId, rect: anchor.getBoundingClientRect() }), 350);
      else if (UNFURLABLE.test(href)) timer.current = setTimeout(() => setHover({ kind: 'external', url: href, rect: anchor.getBoundingClientRect() }), 350);
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
  const onEnter = () => {
    overCard.current = true;
    clearTimeout(timer.current);
  };
  const onLeave = () => {
    overCard.current = false;
    setHover(null);
  };
  return createPortal(
    hover.kind === 'page' ? <PreviewCard id={hover.id} rect={hover.rect} onEnter={onEnter} onLeave={onLeave} /> : <UnfurlCard url={hover.url} rect={hover.rect} onEnter={onEnter} onLeave={onLeave} />,
    document.body,
  );
}

function cardStyle(rect: DOMRect) {
  const width = Math.min(360, window.innerWidth - 32);
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
  const below = rect.bottom + 8 + 180 < window.innerHeight;
  return below ? { left, top: rect.bottom + 8, width } : { left, bottom: window.innerHeight - rect.top + 8, width };
}

const GITHUB_STATE: Record<string, string> = { open: 'Ouvert', closed: 'Fermé', merged: 'Fusionnée', draft: 'Brouillon' };

/** Ticket ou pull request GitHub, ticket Jira: titre et état. Sans aperçu (privé, hors ligne), rien ne s'affiche. */
function UnfurlCard({ url, rect, onEnter, onLeave }: { url: string; rect: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const unfurl = useUnfurl(url);
  if (unfurl.isError) return null;
  const data: Unfurl | undefined = unfurl.data;
  return (
    <div className="pop link-preview unfurl" role="tooltip" style={cardStyle(rect)} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {data?.kind === 'github' ? (
        <>
          <span className="unfurl-src">
            <GitPullRequestIcon size={14} aria-hidden />
            {data.repo} #{data.number}
          </span>
          <b className="unfurl-title">{data.title}</b>
          <span className="unfurl-state" data-state={data.state}>
            <RecordIcon size={10} weight="fill" aria-hidden />
            {data.type === 'pull' ? (GITHUB_STATE[data.state] ?? data.state) : data.state === 'open' ? 'Ouvert' : 'Fermé'}
            {data.author && <> · {data.author}</>}
          </span>
        </>
      ) : data?.kind === 'jira' ? (
        <>
          <span className="unfurl-src">
            <KanbanIcon size={14} aria-hidden />
            {data.key}
            {data.type && <> · {data.type}</>}
          </span>
          <b className="unfurl-title">{data.summary}</b>
          <span className="unfurl-state" data-state={data.category}>
            <RecordIcon size={10} weight="fill" aria-hidden />
            {data.status}
          </span>
        </>
      ) : (
        <span className="doc-skeleton" aria-busy="true" aria-label="Chargement de l'aperçu">
          <span />
          <span />
        </span>
      )}
    </div>
  );
}

function PreviewCard({ id, rect, onEnter, onLeave }: { id: string; rect: DOMRect; onEnter: () => void; onLeave: () => void }) {
  const preview = usePagePreview(id);
  const style = cardStyle(rect);
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
