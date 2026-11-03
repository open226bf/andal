import { ArrowDownIcon, ArrowUpIcon, ArrowsDownUpIcon, DotsThreeIcon, FilePlusIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useState, type FormEvent } from 'react';
import { api, canEdit, errorMessage, useTrash, type Tree, type TreePage } from '../lib/api';
import { date, relative } from '../lib/format';
import { FormError } from './AuthCard';
import { ConfirmDialog, Modal } from './Dialog';

export type PageDialog =
  | { kind: 'create'; parent: TreePage | null }
  | { kind: 'rename'; page: TreePage }
  | { kind: 'move'; page: TreePage }
  | { kind: 'delete'; page: TreePage }
  | { kind: 'trash' };

/** Les sous-pages visibles d'une page, à toutes profondeurs. */
export function descendants(tree: Tree, id: string): TreePage[] {
  const out: TreePage[] = [];
  const visit = (parent: string) => {
    for (const p of tree.pages) {
      if (p.parentId !== parent) continue;
      out.push(p);
      visit(p.id);
    }
  };
  visit(id);
  return out;
}

/** Le menu « ⋯ » d'une page du sommaire, pour qui peut la modifier. */
export function PageMenu({
  page,
  previous,
  nextButOne,
  isLast,
  onDialog,
  onMove,
}: {
  page: TreePage;
  previous: TreePage | undefined;
  /** La sœur qui suit la suivante: « descendre » place la page juste avant elle. */
  nextButOne: TreePage | null;
  isLast: boolean;
  onDialog: (dialog: PageDialog) => void;
  onMove: (beforeId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="node-menu" aria-label={`Actions pour ${page.number} ${page.title}`}>
          <DotsThreeIcon size={18} weight="bold" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop menu" side="right" align="start" sideOffset={6} collisionPadding={16}>
          <button type="button" className="menu-item" onClick={run(() => onDialog({ kind: 'create', parent: page }))}>
            <FilePlusIcon size={18} aria-hidden />
            Ajouter une sous-page
          </button>
          <button type="button" className="menu-item" onClick={run(() => onDialog({ kind: 'rename', page }))}>
            <PencilSimpleIcon size={18} aria-hidden />
            Renommer
          </button>
          <button type="button" className="menu-item" disabled={!previous} onClick={run(() => previous && onMove(previous.id))}>
            <ArrowUpIcon size={18} aria-hidden />
            Monter
          </button>
          <button type="button" className="menu-item" disabled={isLast} onClick={run(() => onMove(nextButOne?.id ?? null))}>
            <ArrowDownIcon size={18} aria-hidden />
            Descendre
          </button>
          <button type="button" className="menu-item" onClick={run(() => onDialog({ kind: 'move', page }))}>
            <ArrowsDownUpIcon size={18} aria-hidden />
            Déplacer sous…
          </button>
          <button type="button" className="menu-item danger" onClick={run(() => onDialog({ kind: 'delete', page }))}>
            <TrashIcon size={18} aria-hidden />
            Mettre à la corbeille
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Les boîtes de dialogue des pages: créer, renommer, déplacer, mettre à la corbeille, restaurer. */
export function PageDialogs({
  tree,
  dialog,
  onClose,
  onCreated,
  onDeleted,
  onRestored,
  onChanged,
}: {
  tree: Tree;
  dialog: PageDialog | null;
  onClose: () => void;
  onCreated: (id: string) => void;
  onDeleted: (page: TreePage) => void;
  onRestored: (id: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const title =
    dialog?.kind === 'create'
      ? dialog.parent
        ? `Nouvelle page sous « ${dialog.parent.number} ${dialog.parent.title} »`
        : 'Nouvelle page'
      : dialog?.kind === 'rename'
        ? `Renommer « ${dialog.page.number} ${dialog.page.title} »`
        : dialog?.kind === 'move'
          ? `Déplacer « ${dialog.page.number} ${dialog.page.title} »`
          : dialog?.kind === 'trash'
            ? `Corbeille de ${tree.project.shortName}`
            : '';

  if (dialog?.kind === 'delete') {
    const count = descendants(tree, dialog.page.id).length;
    return (
      <ConfirmDialog
        confirmation={{
          title: `Mettre « ${dialog.page.number} ${dialog.page.title} » à la corbeille ?`,
          body: `${count > 0 ? `Ses ${count} sous-page${count > 1 ? 's' : ''} aussi. ` : ''}Elle disparaît du sommaire et de la recherche pour tout le monde. Vous pourrez la restaurer depuis la corbeille du volume, avec ses commentaires.`,
          action: 'Mettre à la corbeille',
          run: async () => {
            await api(`/pages/${dialog.page.id}`, { method: 'DELETE' });
            onDeleted(dialog.page);
          },
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal open={dialog !== null} onOpenChange={(open) => !open && onClose()} title={title}>
      {dialog?.kind === 'create' && (
        <TitleForm
          submitLabel="Créer la page"
          hint={dialog.parent ? 'Elle hérite des restrictions de sa page parente.' : 'Elle prend les droits du volume.'}
          onSubmit={async ({ title: name }) => {
            const { id } = await api<{ id: string }>(`/projects/${tree.project.id}/pages`, { method: 'POST', body: JSON.stringify({ title: name, parentId: dialog.parent?.id ?? null }) });
            await onChanged();
            onCreated(id);
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <TitleForm
          initial={dialog.page.title}
          submitLabel="Renommer"
          onSubmit={async ({ title: name }) => {
            await api(`/pages/${dialog.page.id}`, { method: 'PATCH', body: JSON.stringify({ title: name }) });
            await onChanged();
            onClose();
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveForm
          tree={tree}
          page={dialog.page}
          onSubmit={async (parentId) => {
            await api(`/pages/${dialog.page.id}/move`, { method: 'POST', body: JSON.stringify({ parentId, beforeId: null }) });
            await onChanged();
            onClose();
          }}
        />
      )}
      {dialog?.kind === 'trash' && <TrashList projectId={tree.project.id} onRestored={onRestored} />}
    </Modal>
  );
}

function TitleForm({ initial = '', submitLabel, hint, onSubmit }: { initial?: string; submitLabel: string; hint?: string; onSubmit: (values: { title: string }) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit({ title: value });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };
  return (
    <form className="dialog-body" onSubmit={(e) => void submit(e)}>
      {error && <FormError>{error}</FormError>}
      <div className="field">
        <label htmlFor="page-title">Titre</label>
        <input id="page-title" className="input" required autoFocus maxLength={120} value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
      </div>
      {hint && <p className="form-hint">{hint}</p>}
      <button type="submit" className="btn-ink" disabled={pending || !value.trim() || value.trim() === initial}>
        {submitLabel}
      </button>
    </form>
  );
}

/** Nouvelle page parente: le premier niveau, ou une page où l'on peut écrire, hors de la page elle-même et de ses sous-pages. */
function MoveForm({ tree, page, onSubmit }: { tree: Tree; page: TreePage; onSubmit: (parentId: string | null) => Promise<void> }) {
  const excluded = new Set([page.id, ...descendants(tree, page.id).map((p) => p.id)]);
  const options = tree.pages.filter((p) => !excluded.has(p.id) && canEdit(p.role));
  const [parent, setParent] = useState<string>(page.parentId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(parent || null);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };
  return (
    <form className="dialog-body" onSubmit={(e) => void submit(e)}>
      {error && <FormError>{error}</FormError>}
      <div className="field">
        <label htmlFor="move-parent">Placer sous</label>
        <select id="move-parent" className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
          {canEdit(tree.project.role) && <option value="">Premier niveau du volume</option>}
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {'  '.repeat(p.number.split('.').length - 1)}
              {p.number} {p.title}
            </option>
          ))}
        </select>
      </div>
      <p className="form-hint">Elle se range à la fin de sa nouvelle section, avec ses sous-pages. Monter et Descendre ajustent ensuite sa place.</p>
      <button type="submit" className="btn-ink" disabled={pending || parent === (page.parentId ?? '')}>
        Déplacer
      </button>
    </form>
  );
}

function TrashList({ projectId, onRestored }: { projectId: string; onRestored: (id: string) => void }) {
  const trash = useTrash(projectId, true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // La page dont on confirme la suppression définitive, dans sa ligne.
  const [purging, setPurging] = useState<string | null>(null);
  const act = async (id: string, action: () => Promise<void>) => {
    setError(null);
    setPending(id);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
      setPurging(null);
      await trash.refetch();
    }
  };
  if (trash.isPending) return <div className="dialog-body doc-skeleton" aria-busy="true" aria-label="Chargement de la corbeille"><span /><span /></div>;
  if (trash.isError) return <div className="dialog-body"><FormError>{errorMessage(trash.error, 'Impossible de charger la corbeille.')}</FormError></div>;
  return (
    <div className="dialog-body">
      {error && <FormError>{error}</FormError>}
      {trash.data.length === 0 ? (
        <p className="dialog-text">La corbeille est vide.</p>
      ) : (
        <ul className="trash-list">
          {trash.data.map((entry) =>
            purging === entry.id ? (
              <li key={entry.id} className="trash-confirm">
                <span>
                  <b>Supprimer « {entry.title} » définitivement ?</b>
                  <small>
                    {entry.subpages > 0 ? `Ses ${entry.subpages} sous-page${entry.subpages > 1 ? 's' : ''}, ses` : 'Ses'} commentaires et son historique disparaissent aussi. C’est sans retour.
                  </small>
                </span>
                <span className="trash-actions">
                  <button type="button" className="btn-line sm" disabled={pending !== null} onClick={() => setPurging(null)}>
                    Annuler
                  </button>
                  <button type="button" className="btn-danger sm" disabled={pending !== null} onClick={() => void act(entry.id, () => api(`/pages/${entry.id}/purge`, { method: 'DELETE' }))}>
                    {pending === entry.id ? 'Suppression…' : 'Supprimer'}
                  </button>
                </span>
              </li>
            ) : (
              <li key={entry.id}>
                <span>
                  <b>{entry.title}</b>
                  <small>
                    {entry.subpages > 0 && `avec ${entry.subpages} sous-page${entry.subpages > 1 ? 's' : ''} · `}
                    {entry.parent ? `sous « ${entry.parent.title} »${entry.parent.deleted ? ' (à la corbeille)' : ''} · ` : ''}
                    {entry.deletedBy ? `par ${entry.deletedBy}, ` : ''}
                    {relative(entry.deletedAt)}
                  </small>
                  <small>Supprimée définitivement le {date(entry.purgeAt)}</small>
                </span>
                <span className="trash-actions">
                  {entry.canPurge && (
                    <button type="button" className="ghost danger" disabled={pending !== null} onClick={() => setPurging(entry.id)} aria-label={`Supprimer définitivement ${entry.title}`}>
                      Supprimer
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-line sm"
                    disabled={pending !== null}
                    onClick={() =>
                      void act(entry.id, async () => {
                        await api(`/pages/${entry.id}/restore`, { method: 'POST' });
                        onRestored(entry.id);
                      })
                    }
                  >
                    {pending === entry.id ? 'Restauration…' : 'Restaurer'}
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {trash.data.length > 0 && <p className="form-hint">Une page restaurée revient à la fin de sa section, avec ses sous-pages et ses commentaires. Les autres sont supprimées définitivement à la date indiquée.</p>}
    </div>
  );
}
