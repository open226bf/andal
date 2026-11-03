import { ArchiveIcon, ArrowLeftIcon, ArrowRightIcon, ListIcon, LockSimpleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import type { Editor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, canComment, canEdit, errorMessage, useMe, useNotifications, usePage, useProjects, useThreads, useTree, type PageDetail } from '../lib/api';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Band } from '../components/Band';
import { Colophon } from '../components/Colophon';
import { CommentComposer } from '../components/CommentComposer';
import { HistoryDialog } from '../components/HistoryDialog';
import { InsertBar } from '../components/InsertBar';
import { MarginNotes } from '../components/MarginNotes';
import { SearchDialog } from '../components/SearchDialog';
import { Shelf } from '../components/Shelf';
import { Sommaire } from '../components/Sommaire';
import { DocEditor, type PresenceUser } from '../editor/DocEditor';
import { DocContext } from '../lib/doc-context';

/** La page de doc: étagère, sommaire, bandeau du volume, colophon, éditeur et notes en marge. */
export function DocPage({ slug, pageId, thread, edition }: { slug: string; pageId: string; thread?: string; edition?: boolean }) {
  const me = useMe();
  const projects = useProjects();
  const tree = useTree(slug);
  const page = usePage(pageId);

  const [editing, setEditing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);

  // Le sommaire porte le volume, archivé compris (absent de l'étagère).
  const project = tree.data?.project ?? projects.data?.find((p) => p.slug === slug);
  const cloth = page.data?.project.cloth ?? project?.cloth;

  // La couleur du volume teinte toute l'interface, popovers compris.
  useEffect(() => {
    if (cloth) document.documentElement.dataset.vol = cloth;
  }, [cloth]);

  useEffect(() => {
    setEditing(Boolean(edition));
    setNavOpen(false);
    window.scrollTo({ top: 0 });
    // `edition` ne compte qu'à l'arrivée sur la page.
  }, [pageId]);

  // En mobile, le sommaire est un tiroir: fermé, il sort de l'ordre de tabulation; ouvert, Échap le referme.
  const compact = useMediaQuery('(max-width: 860px)');
  useEffect(() => {
    if (!navOpen) return;
    document.querySelector<HTMLElement>('#nav [aria-current="page"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  useEffect(() => {
    if (page.data) document.title = `${page.data.number} ${page.data.title} · ${page.data.project.shortName} · Andal`;
  }, [page.data]);

  if (!me.data || !projects.data) return null;

  return (
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />
      <div className="nav-wrap" id="nav" inert={compact && !navOpen}>
        <Shelf projects={projects.data} current={slug} me={me.data} />
        {tree.data ? <Sommaire tree={tree.data} currentPageId={pageId} onSearch={() => setSearchOpen(true)} /> : <nav className="toc" aria-busy="true" />}
      </div>
      <main className="main">
        <div className="topbar">
          <button type="button" className="icon-btn" aria-label="Ouvrir le sommaire" aria-expanded={navOpen} aria-controls="nav" onClick={() => setNavOpen(true)}>
            <ListIcon size={20} aria-hidden />
          </button>
          <span className="topbar-vol">
            <span className="vol-swatch" aria-hidden />
            {project?.shortName}
          </span>
          <button type="button" className="icon-btn push" aria-label="Rechercher" onClick={() => setSearchOpen(true)}>
            <MagnifyingGlassIcon size={20} aria-hidden />
          </button>
        </div>
        {/* Un accès retiré pendant la lecture: la page relue répond 404, même si l'ancienne version est en cache. */}
        {page.data && !(page.error instanceof ApiError && page.error.status === 404) ? (
          <Document key={page.data.id} page={page.data} me={me.data.user} archived={tree.data?.project.archived ?? false} editing={editing} presence={presence} thread={thread} onMode={setEditing} onPresence={setPresence} />
        ) : page.error ? (
          <Missing error={page.error} />
        ) : (
          <div className="page">
            <div className="sheet">
              <div className="measure doc-skeleton" aria-busy="true" aria-label="Chargement de la page">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function Document({
  page,
  me,
  archived,
  editing,
  presence,
  thread,
  onMode,
  onPresence,
}: {
  page: PageDetail;
  me: { name: string; color: string };
  archived: boolean;
  editing: boolean;
  presence: PresenceUser[];
  thread?: string;
  onMode: (editing: boolean) => void;
  onPresence: (users: PresenceUser[]) => void;
}) {
  const threads = useThreads(page.id);
  const queryClient = useQueryClient();
  const refreshThreads = useCallback(() => void queryClient.invalidateQueries({ queryKey: ['threads', page.id] }), [queryClient, page.id]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const measureRef = useRef<HTMLDivElement>(null);
  const notifications = useNotifications();

  // Arrivé par une notification (interface ou email): celles de ce fil sont lues.
  const unreadHere = (notifications.data?.items ?? []).filter((n) => !n.read && n.threadId === thread).map((n) => n.id);
  useEffect(() => {
    if (unreadHere.length === 0) return;
    void api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids: unreadHere }) }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
  }, [unreadHere.join(','), queryClient]);
  const writable = canEdit(page.role);
  // Droit d'écriture retiré pendant l'édition (restriction, volume archivé): retour en lecture.
  useEffect(() => {
    if (editing && !writable) onMode(false);
  }, [editing, writable, onMode]);
  const user = useMemo(() => ({ name: me.name, color: me.color }), [me.name, me.color]);
  const context = useMemo(
    () => ({ chapter: page.numbering.chapter, figureOffset: page.numbering.figureOffset, listingOffset: page.numbering.listingOffset, editing }),
    [page.numbering, editing],
  );

  return (
    <>
      <Band page={page} editing={editing} canEdit={writable} presence={presence} onMode={onMode} />
      <HistoryDialog page={page} open={historyOpen} onOpenChange={setHistoryOpen} context={context} />
      {editing && writable && editor && <InsertBar editor={editor} />}
      <article className="page" data-editing={editing}>
        <div className="sheet">
          <div className="measure" ref={measureRef}>
            {archived && (
              <p className="archived-note" role="note">
                <ArchiveIcon size={18} aria-hidden />
                Volume archivé: ses pages se lisent, mais ne se modifient ni ne se commentent plus.
              </p>
            )}
            <h1 className="doc-title">
              <span className="secnum">{page.number}</span>
              {editing && writable ? <TitleField key={page.title} page={page} /> : page.title}
            </h1>
            {page.summary && <p className="lede">{page.summary}</p>}
            <Colophon page={page} onHistory={() => setHistoryOpen(true)} />
            <DocContext.Provider value={context}>
              <div style={{ '--chapter-prefix': `"${page.number}."` } as CSSProperties}>
                <DocEditor pageId={page.id} user={user} editable={editing && writable} onPresence={onPresence} onEditor={setEditor} onThreadsChanged={refreshThreads} />
              </div>
            </DocContext.Provider>
            {editor && canComment(page.role) && <CommentComposer editor={editor} pageId={page.id} container={measureRef} onCreated={refreshThreads} />}
            <MarginNotes threads={threads.data ?? []} editor={editor} container={measureRef} pageId={page.id} focus={thread} onChanged={refreshThreads} />
            <footer className="after">
              <nav className="pager" aria-label="Pages voisines">
                {page.prev && (
                  <Link to="/v/$slug/$pageId" params={{ slug: page.project.slug, pageId: page.prev.id }}>
                    <ArrowLeftIcon size={18} aria-hidden />
                    <span>
                      <span className="num">{page.prev.number}</span> {page.prev.title}
                    </span>
                  </Link>
                )}
                {page.next && (
                  <Link className="next" to="/v/$slug/$pageId" params={{ slug: page.project.slug, pageId: page.next.id }}>
                    <span>
                      <span className="num">{page.next.number}</span> {page.next.title}
                    </span>
                    <ArrowRightIcon size={18} aria-hidden />
                  </Link>
                )}
              </nav>
              <p className="fiction">Démo Andal. Personnes, équipes et adresses sont fictives.</p>
            </footer>
          </div>
        </div>
      </article>
    </>
  );
}

/** Le titre, modifiable en mode Modifier: enregistré en quittant le champ ou avec Entrée, Échap annule. */
function TitleField({ page }: { page: PageDetail }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(page.title);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const next = value.trim();
    if (!next || next === page.title) {
      setValue(page.title);
      return;
    }
    setError(null);
    try {
      await api(`/pages/${page.id}`, { method: 'PATCH', body: JSON.stringify({ title: next }) });
      await Promise.all(['page', 'tree'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    } catch (err) {
      setError(errorMessage(err));
      setValue(page.title);
    }
  };

  return (
    <>
      <input
        className="doc-title-input"
        aria-label="Titre de la page"
        maxLength={120}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setValue(page.title);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
      {error && <span className="title-error">{error}</span>}
    </>
  );
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Une page illisible et une page absente répondent pareil: on ne révèle pas son existence. */
function Missing({ error }: { error: Error }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="page">
      <div className="sheet">
        <div className="measure">
          <p className="doc-state">
            <LockSimpleIcon size={18} aria-hidden />
            {notFound ? "Cette page n'existe pas, ou vous n'y avez pas accès." : 'La page ne répond pas. Réessayez dans un instant.'}
          </p>
        </div>
      </div>
    </div>
  );
}
