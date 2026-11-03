import { BookOpenIcon, ListIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { FormError } from '../components/AuthCard';
import { SearchDialog } from '../components/SearchDialog';
import { Shelf } from '../components/Shelf';
import { Sommaire } from '../components/Sommaire';
import { api, canEdit, errorMessage, useMe, useProjects, useTree } from '../lib/api';
import { t } from '../lib/i18n';

/** Un volume sans page lisible: tout est à la corbeille, ou rien n'y est encore écrit. */
export function EmptyVolumePage({ slug }: { slug: string }) {
  const me = useMe();
  const projects = useProjects();
  const tree = useTree(slug);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const project = tree.data?.project;
  useEffect(() => {
    if (project) {
      document.documentElement.dataset.vol = project.cloth;
      document.title = `${project.shortName} · Andal`;
    }
  }, [project]);

  // Une page est apparue (créée ici ou ailleurs): on y va.
  const first = tree.data?.pages[0];
  useEffect(() => {
    if (first) void navigate({ to: '/v/$slug/$pageId', params: { slug, pageId: first.id }, replace: true });
  }, [first, slug, navigate]);

  if (!me.data || !projects.data || !tree.data || !project) return null;

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>(`/projects/${project.id}/pages`, { method: 'POST', body: JSON.stringify({ title: t('Présentation') }) });
      await queryClient.invalidateQueries({ queryKey: ['tree', slug] });
      await navigate({ to: '/v/$slug/$pageId', params: { slug, pageId: id }, search: { edition: true } });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />
      <div className="nav-wrap" id="nav">
        <Shelf projects={projects.data} current={slug} me={me.data} />
        <Sommaire tree={tree.data} currentPageId="" onSearch={() => setSearchOpen(true)} />
      </div>
      <main className="main">
        <div className="topbar">
          <button type="button" className="icon-btn" aria-label={t('Ouvrir le sommaire')} aria-expanded={navOpen} aria-controls="nav" onClick={() => setNavOpen(true)}>
            <ListIcon size={20} aria-hidden />
          </button>
          <span className="topbar-vol">
            <span className="vol-swatch" aria-hidden />
            {project.shortName}
          </span>
        </div>
        <div className="page">
          <div className="sheet">
            <div className="measure empty-volume">
              <BookOpenIcon size={28} aria-hidden />
              <h1 className="doc-title">{project.name}</h1>
              <p className="dialog-text">
                {canEdit(project.role)
                  ? t('Ce volume n’a pas encore de page, ou elles sont toutes à la corbeille (en bas du sommaire).')
                  : t('Ce volume n’a pas encore de page que vous puissiez lire.')}
              </p>
              {error && <FormError>{error}</FormError>}
              {canEdit(project.role) && (
                <button type="button" className="btn-ink" disabled={pending} onClick={() => void create()}>
                  {t('Écrire la première page')}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
