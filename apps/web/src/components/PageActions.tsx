import { PAGE_TEMPLATES, type TemplateId } from '@andal/editor/templates';
import { ArrowDownIcon, ArrowUpIcon, ArrowsDownUpIcon, ChatsCircleIcon, DotsThreeIcon, FileDashedIcon, FilePlusIcon, LifebuoyIcon, PencilSimpleIcon, SignpostIcon, SirenIcon, TrashIcon, type Icon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useRef, useState, type FormEvent } from 'react';
import { api, canEdit, errorMessage, useTrash, type Tree, type TreePage } from '../lib/api';
import { date, relative } from '../lib/format';
import { locale, t, tn } from '../lib/i18n';
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
        <CreateForm
          hint={dialog.parent ? t('Elle hérite des restrictions de sa page parente.') : t('Elle prend les droits du volume.')}
          onSubmit={async ({ title: name, template }) => {
            const { id } = await api<{ id: string }>(`/projects/${tree.project.id}/pages`, { method: 'POST', body: JSON.stringify({ title: name, parentId: dialog.parent?.id ?? null, template }) });
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

const TEMPLATE_ICONS: Record<TemplateId, Icon> = { adr: SignpostIcon, rfc: ChatsCircleIcon, runbook: LifebuoyIcon, postmortem: SirenIcon };

/**
 * Nouvelle page: un titre, et de quoi partir. Choisir un modèle propose son
 * début de titre (« Décision : ») tant que le champ est vide ou n'a pas été retouché.
 */
function CreateForm({ hint, onSubmit }: { hint: string; onSubmit: (values: { title: string; template: TemplateId | null }) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const prefix = (id: TemplateId | null) => (id ? (PAGE_TEMPLATES.find((p) => p.id === id)?.title[locale] ?? '') : '');

  const choose = (id: TemplateId | null) => {
    if (!value.trim() || value === prefix(template)) setValue(prefix(id));
    setTemplate(id);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit({ title: value, template });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };
  const options: { id: TemplateId | null; name: string; description: string; icon: Icon }[] = [
    { id: null, name: t('Page vide'), description: t('Une page blanche, à écrire de zéro.'), icon: FileDashedIcon },
    ...PAGE_TEMPLATES.map((p) => ({ id: p.id, name: p.name[locale], description: p.description[locale], icon: TEMPLATE_ICONS[p.id] })),
  ];

  return (
    <form className="dialog-body" onSubmit={(e) => void submit(e)}>
      {error && <FormError>{error}</FormError>}
      <div className="field">
        <label htmlFor="page-title">{t('Titre')}</label>
        <input ref={input} id="page-title" className="input" required autoFocus maxLength={120} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <fieldset className="field">
        <legend>{t('Partir de')}</legend>
        <div className="templates">
          {options.map((option) => {
            const OptionIcon = option.icon;
            return (
              <label key={option.id ?? 'blank'} className="template">
                <input
                  type="radio"
                  name="template"
                  checked={template === option.id}
                  onChange={() => {
                    choose(option.id);
                    // Le titre proposé se complète: curseur à la fin.
                    requestAnimationFrame(() => {
                      const el = input.current;
                      el?.focus();
                      el?.setSelectionRange(el.value.length, el.value.length);
                    });
                  }}
                />
                <OptionIcon size={20} aria-hidden />
                <span>
                  <b>{option.name}</b>
                  <small>{option.description}</small>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p className="form-hint">{hint}</p>
      <button type="submit" className="btn-ink" disabled={pending || !value.trim() || value.trim() === prefix(template).trim()}>
        {t('Créer la page')}
      </button>
    </form>
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
