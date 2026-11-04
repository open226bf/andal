import { ArrowLeftIcon, ArrowRightIcon, GlobeHemisphereWestIcon, LinkBreakIcon, ListIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { readExtensions } from '../editor/extensions';
import { usePublicPage, usePublicShare, type PublicPage as PublicPageData, type PublicShare } from '../lib/api';
import { DocContext } from '../lib/doc-context';
import { date } from '../lib/format';
import { t, tn } from '../lib/i18n';
import { useTheme } from '../lib/theme';

/**
 * Un partage public, lu sans compte: le sommaire des pages publiées et la page
 * en lecture seule. Ni commentaires, ni historique, ni accès au reste du volume.
 */
export function PublicPage({ token, pageId }: { token: string; pageId?: string }) {
  const share = usePublicShare(token);
  const current = pageId ?? share.data?.root;
  const page = usePublicPage(token, current ?? '');
  const [navOpen, setNavOpen] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    if (share.data) document.documentElement.dataset.vol = share.data.project.cloth;
  }, [share.data]);
  useEffect(() => {
    if (page.data && share.data) document.title = `${page.data.number} ${page.data.title} · ${share.data.project.shortName}`;
  }, [page.data, share.data]);
  // Un lien public n'est pas fait pour les moteurs de recherche.
  useEffect(() => {
    const meta = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.append(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  }, [current]);

  if (share.error) {
    return (
      <div className="public-gone">
        <LinkBreakIcon size={28} aria-hidden />
        <h1>{t('Ce lien ne mène plus nulle part')}</h1>
        <p>{t('Il a été retiré, ou la page qu’il partageait n’est plus publique.')}</p>
      </div>
    );
  }
  if (!share.data || !current) return null;

  return (
    <div className={`app public-app${navOpen ? ' nav-open' : ''}`}>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />
      <div className="nav-wrap" id="nav">
        <PublicContents share={share.data} token={token} current={current} />
      </div>
      <main className="main">
        <div className="topbar">
          <button type="button" className="icon-btn" aria-label={t('Ouvrir le sommaire')} aria-expanded={navOpen} aria-controls="nav" onClick={() => setNavOpen(true)}>
            <ListIcon size={20} aria-hidden />
          </button>
          <span className="topbar-vol">
            <span className="vol-swatch" aria-hidden />
            {share.data.project.shortName}
          </span>
        </div>
        <header className="band">
          <div className="band-vol">
            <span className="band-title">{share.data.project.name}</span>
            <span className="band-meta">{tn(share.data.pages.length, '{n} page publique', '{n} pages publiques')}</span>
          </div>
          <div className="band-actions">
            <span className="public-badge">
              <GlobeHemisphereWestIcon size={16} aria-hidden />
              {t('Lecture publique')}
            </span>
            <button type="button" className="icon-btn on-band" onClick={toggle} aria-label={theme === 'dark' ? t('Passer en thème clair') : t('Passer en thème sombre')}>
              {theme === 'dark' ? <SunIcon size={18} aria-hidden /> : <MoonIcon size={18} aria-hidden />}
            </button>
          </div>
        </header>
        {page.data ? (
          <PublicDocument key={page.data.id} token={token} page={page.data} />
        ) : page.error ? (
          <div className="page">
            <div className="sheet">
              <div className="measure">
                <p className="doc-state">{t("Cette page n'est pas dans ce partage.")}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="page">
            <div className="sheet">
              <div className="measure doc-skeleton" aria-busy="true" aria-label={t('Chargement de la page')}>
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PublicContents({ share, token, current }: { share: PublicShare; token: string; current: string }) {
  const children = new Map<string | null, PublicShare['pages']>();
  for (const page of share.pages) children.set(page.parentId, [...(children.get(page.parentId) ?? []), page]);
  const level = (parent: string | null) => {
    const pages = children.get(parent);
    if (!pages) return null;
    return (
      <ol className={parent ? undefined : 'tree'}>
        {pages.map((page) => (
          <li key={page.id} className={children.has(page.id) ? 'parent' : undefined}>
            <div className="node-row">
              <Link to="/s/$token/$pageId" params={{ token, pageId: page.id }} className="node" aria-current={page.id === current ? 'page' : undefined}>
                <span className="num">{page.number}</span>
                <span className="label">{page.title}</span>
              </Link>
            </div>
            {level(page.id)}
          </li>
        ))}
      </ol>
    );
  };
  return (
    <nav className="toc" aria-label={t('Sommaire du partage')}>
      <div className="toc-vol public-vol">
        <span className="vol-swatch" aria-hidden />
        <span className="toc-vol-text">
          <span>{share.title}</span>
          <small>{t('Vol. {n} · {name}', { n: share.project.volumeNumber, name: share.project.shortName })}</small>
        </span>
      </div>
      <div className="tree-scroll">{level(null)}</div>
      <p className="toc-foot public-foot">{t('Publié avec Andal')}</p>
    </nav>
  );
}

function PublicDocument({ token, page }: { token: string; page: PublicPageData }) {
  const navigate = useNavigate();
  const measure = useRef<HTMLDivElement>(null);
  const context = useMemo(() => ({ chapter: page.numbering.chapter, figureOffset: page.numbering.figureOffset, listingOffset: page.numbering.listingOffset, editing: false, share: token }), [page.numbering, token]);
  const editor = useEditor({ extensions: readExtensions(), content: page.content, editable: false, immediatelyRender: true, editorProps: { attributes: { 'aria-label': t('Contenu de la page') } } }, [page.content]);

  // Liens du texte: une page du partage s'ouvre ici, un lien externe dans un onglet.
  useEffect(() => {
    const root = measure.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.ProseMirror a[href]') : null;
      if (!anchor || anchor.closest('[data-node-view-wrapper]')) return;
      event.preventDefault();
      const href = anchor.getAttribute('href') ?? '';
      const inside = new RegExp(`^/s/${token}/([0-9a-f-]{36})$`).exec(href);
      if (inside) void navigate({ to: '/s/$token/$pageId', params: { token, pageId: inside[1]! } });
      else if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [navigate, token]);

  return (
    <article className="page">
      <div className="sheet">
        <div className="measure" ref={measure}>
          <h1 className="doc-title">
            <span className="secnum">{page.number}</span>
            {page.title}
          </h1>
          {page.summary && <p className="lede">{page.summary}</p>}
          <p className="public-meta">{t('Mise à jour le {date}', { date: date(page.updatedAt) })}</p>
          <DocContext.Provider value={context}>
            <div style={{ '--chapter-prefix': `"${page.number}."` } as CSSProperties}>
              <EditorContent editor={editor} />
            </div>
          </DocContext.Provider>
          <footer className="after">
            <nav className="pager" aria-label={t('Pages voisines')}>
              {page.prev && (
                <Link to="/s/$token/$pageId" params={{ token, pageId: page.prev.id }}>
                  <ArrowLeftIcon size={18} aria-hidden />
                  <span>
                    <span className="num">{page.prev.number}</span> {page.prev.title}
                  </span>
                </Link>
              )}
              {page.next && (
                <Link className="next" to="/s/$token/$pageId" params={{ token, pageId: page.next.id }}>
                  <span>
                    <span className="num">{page.next.number}</span> {page.next.title}
                  </span>
                  <ArrowRightIcon size={18} aria-hidden />
                </Link>
              )}
            </nav>
          </footer>
        </div>
      </div>
    </article>
  );
}
