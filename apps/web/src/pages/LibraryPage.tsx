import { canArrangeLibrary, type WorkspaceRole } from '@andal/authz';
import { AccessMark, accessLabel, accessLevel } from '@andal/ui';
import { ArchiveIcon, BooksIcon, CaretDownIcon, ListIcon, MagnifyingGlassIcon, PlusIcon, PushPinIcon, SquaresFourIcon } from '@phosphor-icons/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormError } from '../components/AuthCard';
import { SearchDialog } from '../components/SearchDialog';
import { Shelf } from '../components/Shelf';
import { RayonsDialog } from '../components/RayonsDialog';
import { ArchivesDialog, NewVolumeDialog } from '../components/VolumeDialogs';
import { errorMessage, useMe, useProjects, useRayons, type ProjectSummary } from '../lib/api';
import { dateTime, relative } from '../lib/format';
import { t, tn } from '../lib/i18n';
import { byRayon, matchesVolume, sortVolumes, useTogglePin, volumeLink, type VolumeSort } from '../lib/volumes';

const SORTS: { value: VolumeSort; label: string }[] = [
  { value: 'number', label: t('Numéro') },
  { value: 'name', label: t('Nom') },
  { value: 'activity', label: t('Activité récente') },
];

const SORT_KEY = 'andal:bibliotheque:tri';
const FOLDED_KEY = 'andal:bibliotheque:replies';
/** Clé de section des volumes hors rayon. */
const OUTSIDE = 'hors-rayon';

function storedSort(): VolumeSort {
  try {
    const value = localStorage.getItem(SORT_KEY);
    return SORTS.some((s) => s.value === value) ? (value as VolumeSort) : 'number';
  } catch {
    return 'number';
  }
}

function storedFolded(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Navigation privée: le réglage vaut pour la visite.
  }
}

/**
 * La bibliothèque: tous les volumes qui vous sont ouverts, rangés par rayon,
 * à filtrer et à trier. Un rayon se replie; sur grand écran, l'index des
 * rayons reste à côté. Ceux que vous épinglez rejoignent votre étagère, à
 * gauche.
 */
export function LibraryPage() {
  const me = useMe();
  const projects = useProjects();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<VolumeSort>(storedSort);
  const [navOpen, setNavOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [archivesOpen, setArchivesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [rayonsOpen, setRayonsOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(storedFolded);
  const rayons = useRayons();
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${t('Bibliothèque')} · Andal`;
  }, []);

  // « / » pour filtrer, comme dans la plupart des outils de doc.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeSort = (value: VolumeSort) => {
    setSort(value);
    remember(SORT_KEY, value);
  };

  const fold = (key: string, open: boolean) => {
    setFolded((current) => {
      const next = new Set(current);
      if (open) next.delete(key);
      else next.add(key);
      remember(FOLDED_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  /** Depuis l'index: ouvrir le rayon et l'amener en vue. */
  const jump = (key: string) => {
    fold(key, true);
    requestAnimationFrame(() => document.getElementById(`rayon-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const volumes = useMemo(() => sortVolumes(projects.data ?? [], sort), [projects.data, sort]);
  const found = volumes.filter((v) => matchesVolume(v, query));
  const searching = query.trim().length > 0;

  if (!me.data) return null;
  const member = me.data.user.workspaceRole !== 'guest';
  const arranger = canArrangeLibrary(me.data.user.workspaceRole as WorkspaceRole);
  const pinned = volumes.filter((v) => v.pinned);
  const shelves = byRayon(volumes, rayons.data ?? [], arranger);
  const rayonNames = new Map((rayons.data ?? []).map((r) => [r.id, r.name]));
  const filed = (rayons.data ?? []).length > 0;

  return (
    <div className={`app library-app${navOpen ? ' nav-open' : ''}`}>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />
      <div className="nav-wrap" id="nav">
        <Shelf projects={projects.data ?? []} current="" me={me.data} library />
      </div>
      <main className="main">
        <div className="topbar">
          <button type="button" className="icon-btn" aria-label={t('Ouvrir l’étagère')} aria-expanded={navOpen} aria-controls="nav" onClick={() => setNavOpen(true)}>
            <ListIcon size={20} aria-hidden />
          </button>
          <span className="topbar-vol">
            <BooksIcon size={18} aria-hidden />
            {t('Bibliothèque')}
          </span>
          <button type="button" className="icon-btn push" aria-label={t('Rechercher dans les pages')} onClick={() => setSearchOpen(true)}>
            <MagnifyingGlassIcon size={20} aria-hidden />
          </button>
        </div>
        <div className="page">
          <div className="library">
            <header className="library-head">
              <div>
                <h1 className="doc-title">{t('Bibliothèque')}</h1>
                {projects.data && (
                  <p className="admin-count">
                    {filed
                      ? tn(volumes.length, '{n} volume ouvert pour vous, en {aisles}', '{n} volumes ouverts pour vous, en {aisles}', {
                          aisles: tn((rayons.data ?? []).length, '{n} rayon', '{n} rayons'),
                        })
                      : tn(volumes.length, '{n} volume ouvert pour vous', '{n} volumes ouverts pour vous')}
                    {' · '}
                    {t('{n} sur votre étagère', { n: pinned.length })}
                  </p>
                )}
              </div>
              {member && (
                <div className="library-actions">
                  <button type="button" className="ghost" onClick={() => setArchivesOpen(true)}>
                    <ArchiveIcon size={16} aria-hidden />
                    {t('Archives')}
                  </button>
                  {arranger && (
                    <button type="button" className="ghost" onClick={() => setRayonsOpen(true)}>
                      <SquaresFourIcon size={16} aria-hidden />
                      {t('Ranger les rayons')}
                    </button>
                  )}
                  <button type="button" className="btn-ink" onClick={() => setNewOpen(true)}>
                    <PlusIcon size={18} aria-hidden />
                    {t('Nouveau volume')}
                  </button>
                </div>
              )}
            </header>

            <div className="library-tools">
              <label className="library-search">
                <MagnifyingGlassIcon size={18} aria-hidden />
                <span className="sr-only">{t('Filtrer les volumes')}</span>
                <input
                  ref={search}
                  type="search"
                  value={query}
                  placeholder={t('Filtrer les volumes')}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && found[0]) void navigate(volumeLink(found[0]));
                    if (e.key === 'Escape') setQuery('');
                  }}
                />
                {!searching && <kbd aria-hidden>/</kbd>}
              </label>
              <label className="library-sort">
                <span>{t('Trier par')}</span>
                <select className="input" value={sort} onChange={(e) => changeSort(e.target.value as VolumeSort)}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {projects.isPending ? (
              <div className="doc-skeleton" aria-busy="true" aria-label={t('Chargement des volumes')}>
                <span />
                <span />
                <span />
              </div>
            ) : projects.isError ? (
              <FormError>{errorMessage(projects.error, t('Impossible de charger les volumes.'))}</FormError>
            ) : volumes.length === 0 ? (
              <div className="library-empty">
                <BooksIcon size={28} aria-hidden />
                <p>
                  <b>{t('Aucun volume ne vous est encore ouvert.')}</b>{' '}
                  {member ? t('Créez le premier, ou demandez à un admin de vous ouvrir ceux de votre équipe.') : t('Un admin de votre espace doit vous y donner accès.')}
                </p>
              </div>
            ) : searching ? (
              <section aria-label={t('Volumes trouvés')}>
                <h2 className="library-section">
                  {found.length === 0 ? t('Aucun volume ne correspond à « {query} »', { query: query.trim() }) : tn(found.length, '{n} volume trouvé', '{n} volumes trouvés')}
                </h2>
                {found.length > 0 && <Catalog volumes={found} rayonNames={rayonNames} />}
                {found.length === 0 && <p className="form-hint">{t('Pour chercher dans les pages elles-mêmes, utilisez la recherche (⌘K).')}</p>}
              </section>
            ) : (
              <div className={`library-body${shelves.length > 1 ? ' indexed' : ''}`}>
                {shelves.length > 1 && (
                  <nav className="rayon-index" aria-label={t('Rayons')}>
                    <ul>
                      {shelves.map(({ rayon, volumes: inside }) => (
                        <li key={rayon?.id ?? OUTSIDE}>
                          <button type="button" onClick={() => jump(rayon?.id ?? OUTSIDE)}>
                            <span>{rayon?.name ?? t('Hors rayon')}</span>
                            <span className="count">{inside.length}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}
                <div className="rayons">
                  {pinned.length === 0 && (
                    <p className="library-hint">
                      <PushPinIcon size={16} aria-hidden />
                      {t('Épinglez les volumes que vous ouvrez souvent: ils restent à portée de main, sur l’étagère à gauche.')}
                    </p>
                  )}
                  {shelves.map(({ rayon, volumes: inside }) => {
                    const key = rayon?.id ?? OUTSIDE;
                    const open = !folded.has(key);
                    const title = rayon?.name ?? (filed ? t('Hors rayon') : t('Tous les volumes'));
                    return (
                      <section key={key} id={`rayon-${key}`} className="rayon" aria-labelledby={`rayon-title-${key}`}>
                        <h2 className="library-section" id={`rayon-title-${key}`}>
                          <button type="button" className="rayon-toggle" aria-expanded={open} aria-controls={`rayon-list-${key}`} onClick={() => fold(key, !open)}>
                            <CaretDownIcon size={16} aria-hidden />
                            {title}
                            <span className="count">{inside.length}</span>
                          </button>
                        </h2>
                        <div id={`rayon-list-${key}`} hidden={!open}>
                          {inside.length > 0 ? (
                            <Catalog volumes={inside} />
                          ) : (
                            <p className="library-hint">{t('Aucun volume dans ce rayon. Rangez-y un volume depuis ses réglages, ou créez-en un.')}</p>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <NewVolumeDialog open={newOpen} onOpenChange={setNewOpen} projects={projects.data ?? []} />
      <ArchivesDialog open={archivesOpen} onOpenChange={setArchivesOpen} />
      {arranger && <RayonsDialog open={rayonsOpen} onOpenChange={setRayonsOpen} volumes={projects.data ?? []} />}
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

/** Le catalogue: une fiche par volume, son dos à gauche, de quoi le situer à droite. */
function Catalog({ volumes, rayonNames }: { volumes: ProjectSummary[]; rayonNames?: Map<string, string> }) {
  const togglePin = useTogglePin();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <FormError>{error}</FormError>}
      <ul className="catalog">
        {volumes.map((v) => {
          const level = accessLevel(v.role);
          return (
            <li key={v.id} className="cat-row" data-vol={v.cloth}>
              <Link {...volumeLink(v)} className="cat-link">
                <span className="cat-spine" aria-hidden>
                  <b>{v.volumeNumber}</b>
                </span>
                <span className="cat-title">
                  <b>
                    <span className="sr-only">{t('Volume {number}, ', { number: v.volumeNumber })}</span>
                    {v.name}
                  </b>
                  {v.description && <span className="cat-desc">{v.description}</span>}
                  {rayonNames && <span className="cat-rayon">{(v.rayonId && rayonNames.get(v.rayonId)) ?? t('Hors rayon')}</span>}
                </span>
                <span className="cat-meta">
                  <span className="cat-access">
                    <AccessMark level={level} />
                    {v.role === 'admin' ? t('Admin') : t(accessLabel(level))}
                  </span>
                  <span className="cat-pages">
                    {tn(v.pageCount, '{n} page', '{n} pages')}
                  </span>
                  <span className="cat-when" title={t('Dernière modification: {date}', { date: dateTime(v.updatedAt) })}>
                    {relative(v.updatedAt)}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                className="cat-pin"
                aria-pressed={v.pinned}
                aria-label={t('Épingler {name} sur l’étagère', { name: v.name })}
                title={v.pinned ? t('Sur l’étagère: cliquer pour l’en retirer') : t('Poser sur l’étagère')}
                onClick={() => {
                  setError(null);
                  togglePin(v).catch((err: unknown) => setError(errorMessage(err)));
                }}
              >
                <PushPinIcon size={18} weight={v.pinned ? 'fill' : 'regular'} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
