import { AccessMark, accessLabel, accessLevel } from '@andal/ui';
import { GearSixIcon, LockSimpleIcon, MagnifyingGlassIcon, PlusIcon, PushPinIcon, TrashIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type DragEvent } from 'react';
import { api, canEdit, errorMessage, useProjects, type Tree, type TreePage } from '../lib/api';
import { age } from '../lib/format';
import { useTogglePin } from '../lib/volumes';
import { descendants, PageDialogs, PageMenu, type PageDialog } from './PageActions';
import { VolumeSettingsDialog } from './VolumeDialogs';
import { VolumeSwitcher } from './VolumeSwitcher';

/** Où lâcher la page tirée: juste avant la page survolée, juste après, ou dedans. */
type DropZone = 'before' | 'after' | 'inside';

/**
 * Le sommaire numéroté du volume. Survoler une page révèle votre droit et l'âge
 * de la dernière modification; qui peut l'écrire y trouve aussi ses actions,
 * et peut la tirer ailleurs dans le sommaire (le menu reste là pour le clavier
 * et les écrans tactiles).
 */
export function Sommaire({ tree, currentPageId, onSearch }: { tree: Tree; currentPageId: string; onSearch: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Le volume tel que l'étagère le connaît (absent s'il est archivé).
  const shelved = useProjects().data?.find((p) => p.id === tree.project.id);
  const togglePin = useTogglePin();
  const [error, setError] = useState<string | null>(null);
  const writer = canEdit(tree.project.role);
  // La page tirée, et ce qu'on ne peut pas viser: elle-même et ses sous-pages.
  const [dragging, setDragging] = useState<{ page: TreePage; excluded: Set<string> } | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);

  const children = new Map<string | null, TreePage[]>();
  for (const page of tree.pages) children.set(page.parentId, [...(children.get(page.parentId) ?? []), page]);

  // Sommaire, numéros des pages ouvertes et corbeille dépendent de la structure.
  const refresh = () => Promise.all(['tree', 'projects', 'page', 'trash'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  const open = (pageId: string, edition = false) => navigate({ to: '/v/$slug/$pageId', params: { slug: tree.project.slug, pageId }, search: edition ? { edition: true } : {} });

  const move = async (page: TreePage, parentId: string | null, beforeId: string | null) => {
    setError(null);
    try {
      await api(`/pages/${page.id}/move`, { method: 'POST', body: JSON.stringify({ parentId, beforeId }) });
    } catch (err) {
      setError(errorMessage(err));
    }
    await refresh();
  };

  const writableUnder = (parentId: string | null) => {
    if (parentId === null) return writer;
    const parent = tree.pages.find((p) => p.id === parentId);
    return parent !== undefined && canEdit(parent.role);
  };

  /** La zone visée selon la hauteur du pointeur dans la ligne. Une page qui a des sous-pages n'a pas d'« après »: on y entre. */
  const zoneAt = (event: DragEvent<HTMLElement>, page: TreePage, hasChildren: boolean): DropZone | null => {
    if (!dragging || dragging.excluded.has(page.id)) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height;
    const beside = writableUnder(page.parentId);
    const inside = canEdit(page.role);
    if (beside && y < 0.3) return 'before';
    if (beside && !hasChildren && y > 0.7) return 'after';
    if (inside) return 'inside';
    if (!beside) return null;
    return y < 0.5 || hasChildren ? 'before' : 'after';
  };

  /** Lâcher: on traduit la zone en nouvelle parente et page voisine, sauf si rien ne bouge. */
  const dropOn = (page: TreePage, zone: DropZone, siblings: TreePage[], index: number) => {
    if (!dragging) return;
    const dragged = dragging.page;
    const parentId = zone === 'inside' ? page.id : page.parentId;
    const beforeId = zone === 'inside' ? null : zone === 'before' ? page.id : (siblings.slice(index + 1).find((p) => p.id !== dragged.id)?.id ?? null);
    const current = children.get(dragged.parentId) ?? [];
    const currentNext = current[current.findIndex((p) => p.id === dragged.id) + 1]?.id ?? null;
    if (parentId === dragged.parentId && beforeId === currentNext) return;
    void move(dragged, parentId, beforeId);
  };

  const endDrag = () => {
    setDragging(null);
    setDrop(null);
  };

  const renderLevel = (parentId: string | null) => {
    const pages = children.get(parentId);
    if (!pages) return null;
    return (
      <ol className={parentId ? undefined : 'tree'}>
        {pages.map((page, i) => {
          const level = accessLevel(page.role);
          const hasChildren = children.has(page.id);
          return (
            <li key={page.id} className={hasChildren ? 'parent' : undefined}>
              <div
                className="node-row"
                data-actions={canEdit(page.role) ? 'true' : undefined}
                data-dragging={dragging?.page.id === page.id ? 'true' : undefined}
                data-drop={drop?.id === page.id ? drop.zone : undefined}
                onDragOver={(event) => {
                  const zone = zoneAt(event, page, hasChildren);
                  if (!zone) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (drop?.id !== page.id || drop.zone !== zone) setDrop({ id: page.id, zone });
                }}
                onDragLeave={(event) => {
                  if (drop?.id === page.id && !event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
                }}
                onDrop={(event) => {
                  const zone = zoneAt(event, page, hasChildren);
                  event.preventDefault();
                  if (zone) dropOn(page, zone, pages, i);
                  endDrag();
                }}
              >
                <Link
                  to="/v/$slug/$pageId"
                  params={{ slug: tree.project.slug, pageId: page.id }}
                  className="node"
                  aria-current={page.id === currentPageId ? 'page' : undefined}
                  draggable={canEdit(page.role)}
                  onDragStart={(event) => {
                    if (!canEdit(page.role)) return;
                    event.dataTransfer.effectAllowed = 'move';
                    setDragging({ page, excluded: new Set([page.id, ...descendants(tree, page.id).map((p) => p.id)]) });
                  }}
                  onDragEnd={endDrag}
                  aria-label={`${page.number} ${page.title}${page.restricted ? ', restreinte' : ''}, ${accessLabel(level).toLowerCase()}`}
                >
                  <span className="num">{page.number}</span>
                  <span className="label">{page.title}</span>
                  <span className={`reveal${page.restricted ? ' always' : ''}`}>
                    {page.restricted && <LockSimpleIcon size={15} aria-hidden />}
                    <AccessMark level={level} />
                    {!page.restricted && age(page.updatedAt)}
                  </span>
                </Link>
                {canEdit(page.role) && (
                  <PageMenu
                    page={page}
                    previous={pages[i - 1]}
                    nextButOne={pages[i + 2] ?? null}
                    isLast={i === pages.length - 1}
                    onDialog={setDialog}
                    onMove={(beforeId) => void move(page, page.parentId, beforeId)}
                  />
                )}
              </div>
              {hasChildren && renderLevel(page.id)}
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <nav className="toc" aria-label="Sommaire du volume">
      <div className="toc-top">
        <button type="button" className="search-btn" onClick={onSearch}>
          <MagnifyingGlassIcon size={18} aria-hidden />
          Rechercher
          <kbd>⌘K</kbd>
        </button>
      </div>
      <div className="toc-vol">
        <span className="vol-swatch" aria-hidden />
        <VolumeSwitcher tree={tree} />
        <span className="toc-actions">
          {shelved && (
            <button
              type="button"
              className="icon-btn sm"
              aria-pressed={shelved.pinned}
              aria-label={`Épingler ${tree.project.name} sur l’étagère`}
              title={shelved.pinned ? 'Sur votre étagère: cliquer pour l’en retirer' : 'Poser sur votre étagère'}
              onClick={() => togglePin(shelved).catch((err: unknown) => setError(errorMessage(err)))}
            >
              <PushPinIcon size={18} weight={shelved.pinned ? 'fill' : 'regular'} aria-hidden />
            </button>
          )}
          {writer && (
            <button type="button" className="icon-btn sm" aria-label="Nouvelle page au premier niveau" title="Nouvelle page" onClick={() => setDialog({ kind: 'create', parent: null })}>
              <PlusIcon size={18} aria-hidden />
            </button>
          )}
          {tree.project.canManage && (
            <button type="button" className="icon-btn sm" aria-label={`Réglages du volume ${tree.project.name}`} title="Réglages du volume" onClick={() => setSettingsOpen(true)}>
              <GearSixIcon size={18} aria-hidden />
            </button>
          )}
        </span>
      </div>
      {tree.project.canManage && <VolumeSettingsDialog tree={tree} open={settingsOpen} onOpenChange={setSettingsOpen} />}
      {error && (
        <p className="toc-error" role="alert">
          {error}
        </p>
      )}
      <div className="tree-scroll">
        {renderLevel(null)}
        {dragging && writer && (
          <div
            className="tree-end"
            data-drop={drop?.id === 'end' ? 'inside' : undefined}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (drop?.id !== 'end') setDrop({ id: 'end', zone: 'inside' });
            }}
            onDragLeave={() => setDrop(null)}
            onDrop={(event) => {
              event.preventDefault();
              // Déjà la dernière page du premier niveau: rien ne bouge.
              if ((children.get(null) ?? []).at(-1)?.id !== dragging.page.id) void move(dragging.page, null, null);
              endDrag();
            }}
          >
            Déposer ici : fin du volume
          </div>
        )}
      </div>
      <div className="toc-foot">
        <AccessMark level="write" /> écrire
        <AccessMark level="comment" /> commenter
        <AccessMark level="read" /> lire
        {writer && (
          <button type="button" className="ghost toc-trash" onClick={() => setDialog({ kind: 'trash' })}>
            <TrashIcon size={15} aria-hidden />
            Corbeille
          </button>
        )}
      </div>
      <PageDialogs
        tree={tree}
        dialog={dialog}
        onClose={() => setDialog(null)}
        onChanged={refresh}
        onCreated={(id) => {
          setDialog(null);
          void open(id, true);
        }}
        onDeleted={async (page) => {
          const gone = new Set([page.id, ...descendants(tree, page.id).map((p) => p.id)]);
          await refresh();
          // La page ouverte vient de partir: on remonte à sa parente, sinon au début du volume.
          if (gone.has(currentPageId)) {
            const fallback = page.parentId ?? tree.pages.find((p) => !gone.has(p.id))?.id;
            if (fallback) await open(fallback);
          }
        }}
        onRestored={async (id) => {
          setDialog(null);
          await refresh();
          await open(id);
        }}
      />
    </nav>
  );
}
