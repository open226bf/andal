import { ArrowDownIcon, ArrowUpIcon, ArrowsDownUpIcon, DotsThreeIcon, FilePlusIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useState, type FormEvent } from 'react';
import { api, canEdit, errorMessage, useTrash, type Tree, type TreePage } from '../lib/api';
import { date, relative } from '../lib/format';
import { t, tn } from '../lib/i18n';
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
        <button type="button" className="node-menu" aria-label={t('Actions pour {number} {title}', { number: page.number, title: page.title })}>
          <DotsThreeIcon size={18} weight="bold" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop menu" side="right" align="start" sideOffset={6} collisionPadding={16}>
          <button type="button" className="menu-item" onClick={run(() => onDialog({ kind: 'create', parent: page }))}>
            <FilePlusIcon size={18} aria-hidden />
            {t('Ajouter une sous-page')}
          </button>
          <button type="button" className="menu-item" onClick={run(() => onDialog({ kind: 'rename', page }))}>
            <PencilSimpleIcon size={18} aria-hidden />
            {t('Renommer')}
          </button>
          <button type="button" className="menu-item" disabled={!previous} onClick={run(() => previous && onMove(previous.id))}>
            <ArrowUpIcon size={18} aria-hidden />
            {t('Monter')}
          </button>
          <button type="button" className="menu-item" disabled={isLast} onClick={run(() => onMove(nextButOne?.id ?? null))}>
            <ArrowDownIcon size={18} aria-hidden />
            {t('Descendre')}
          </button>
          <button type="button" className="menu-item" onClick={run(() => onDialog({ kind: 'move', page }))}>
            <ArrowsDownUpIcon size={18} aria-hidden />
            {t('Déplacer sous…')}
          </button>
          <button type="button" className="menu-item danger" onClick={run(() => onDialog({ kind: 'delete', page }))}>
            <TrashIcon size={18} aria-hidden />
            {t('Mettre à la corbeille')}
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
        ? t('Nouvelle page sous « {number} {title} »', { number: dialog.parent.number, title: dialog.parent.title })
        : t('Nouvelle page')
      : dialog?.kind === 'rename'
        ? t('Renommer « {number} {title} »', { number: dialog.page.number, title: dialog.page.title })
        : dialog?.kind === 'move'
          ? t('Déplacer « {number} {title} »', { number: dialog.page.number, title: dialog.page.title })
          : dialog?.kind === 'trash'
            ? t('Corbeille de {name}', { name: tree.project.shortName })
            : '';

  if (dialog?.kind === 'delete') {
    const count = descendants(tree, dialog.page.id).length;
    const gone = t('Elle disparaît du sommaire et de la recherche pour tout le monde. Vous pourrez la restaurer depuis la corbeille du volume, avec ses commentaires.');
    return (
      <ConfirmDialog
        confirmation={{
          title: t('Mettre « {number} {title} » à la corbeille ?', { number: dialog.page.number, title: dialog.page.title }),
          body: count > 0 ? `${tn(count, 'Sa sous-page aussi.', 'Ses {n} sous-pages aussi.')} ${gone}` : gone,
          action: t('Mettre à la corbeille'),
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
          submitLabel={t('Créer la page')}
          hint={dialog.parent ? t('Elle hérite des restrictions de sa page parente.') : t('Elle prend les droits du volume.')}
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
          submitLabel={t('Renommer')}
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
        <label htmlFor="page-title">{t('Titre')}</label>
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
        <label htmlFor="move-parent">{t('Placer sous')}</label>
        <select id="move-parent" className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
          {canEdit(tree.project.role) && <option value="">{t('Premier niveau du volume')}</option>}
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {'  '.repeat(p.number.split('.').length - 1)}
              {p.number} {p.title}
            </option>
          ))}
        </select>
      </div>
      <p className="form-hint">{t('Elle se range à la fin de sa nouvelle section, avec ses sous-pages. Monter et Descendre ajustent ensuite sa place.')}</p>
      <button type="submit" className="btn-ink" disabled={pending || parent === (page.parentId ?? '')}>
        {t('Déplacer')}
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
  if (trash.isPending) return <div className="dialog-body doc-skeleton" aria-busy="true" aria-label={t('Chargement de la corbeille')}><span /><span /></div>;
  if (trash.isError) return <div className="dialog-body"><FormError>{errorMessage(trash.error, t('Impossible de charger la corbeille.'))}</FormError></div>;
  return (
    <div className="dialog-body">
      {error && <FormError>{error}</FormError>}
      {trash.data.length === 0 ? (
        <p className="dialog-text">{t('La corbeille est vide.')}</p>
      ) : (
        <ul className="trash-list">
          {trash.data.map((entry) =>
            purging === entry.id ? (
              <li key={entry.id} className="trash-confirm">
                <span>
                  <b>{t('Supprimer « {title} » définitivement ?', { title: entry.title })}</b>
                  <small>
                    {entry.subpages > 0
                      ? tn(entry.subpages, 'Sa sous-page, ses commentaires et son historique disparaissent aussi. C’est sans retour.', 'Ses {n} sous-pages, ses commentaires et son historique disparaissent aussi. C’est sans retour.')
                      : t('Ses commentaires et son historique disparaissent aussi. C’est sans retour.')}
                  </small>
                </span>
                <span className="trash-actions">
                  <button type="button" className="btn-line sm" disabled={pending !== null} onClick={() => setPurging(null)}>
                    {t('Annuler')}
                  </button>
                  <button type="button" className="btn-danger sm" disabled={pending !== null} onClick={() => void act(entry.id, () => api(`/pages/${entry.id}/purge`, { method: 'DELETE' }))}>
                    {pending === entry.id ? t('Suppression…') : t('Supprimer')}
                  </button>
                </span>
              </li>
            ) : (
              <li key={entry.id}>
                <span>
                  <b>{entry.title}</b>
                  <small>
                    {entry.subpages > 0 && `${tn(entry.subpages, 'avec {n} sous-page', 'avec {n} sous-pages')} · `}
                    {entry.parent ? `${entry.parent.deleted ? t('sous « {title} » (à la corbeille)', { title: entry.parent.title }) : t('sous « {title} »', { title: entry.parent.title })} · ` : ''}
                    {entry.deletedBy ? t('par {name}, {when}', { name: entry.deletedBy, when: relative(entry.deletedAt) }) : relative(entry.deletedAt)}
                  </small>
                  <small>{t('Supprimée définitivement le {date}', { date: date(entry.purgeAt) })}</small>
                </span>
                <span className="trash-actions">
                  {entry.canPurge && (
                    <button type="button" className="ghost danger" disabled={pending !== null} onClick={() => setPurging(entry.id)} aria-label={t('Supprimer définitivement {title}', { title: entry.title })}>
                      {t('Supprimer')}
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
                    {pending === entry.id ? t('Restauration…') : t('Restaurer')}
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {trash.data.length > 0 && <p className="form-hint">{t('Une page restaurée revient à la fin de sa section, avec ses sous-pages et ses commentaires. Les autres sont supprimées définitivement à la date indiquée.')}</p>}
    </div>
  );
}
