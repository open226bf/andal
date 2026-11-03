import { Avatar } from '@andal/ui';
import { DotsThreeIcon, PencilSimpleIcon, PlusIcon, TrashIcon, UsersThreeIcon, XIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError } from '../components/AuthCard';
import { Picker } from '../components/Picker';
import { api, errorMessage, useGroups, type GroupView, type GroupsOverview } from '../lib/api';
import { ConfirmDialog, Modal, type Confirmation } from '../components/Dialog';

const VOLUME_ROLE: Record<string, string> = { reader: 'lecture', commenter: 'commentaire', editor: 'écriture', admin: 'admin' };

/** Groupes de l'espace: membres, volumes ouverts, pages restreintes. */
export function GroupsSection() {
  const groups = useGroups();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ group: GroupView | null } | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);

  // Un membre ajouté ou retiré change des droits partout: tout ce qui en dépend est relu.
  const refresh = () => Promise.all(['admin', 'sharing', 'page', 'tree', 'projects'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  const act = async (run: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    let ok = true;
    try {
      await run();
    } catch (err) {
      setError(errorMessage(err));
      ok = false;
    }
    await refresh();
    return ok;
  };

  if (groups.isPending) return <div className="doc-skeleton" aria-busy="true" aria-label="Chargement des groupes"><span /><span /><span /></div>;
  if (groups.isError) return <FormError>{errorMessage(groups.error, 'Impossible de charger les groupes.')}</FormError>;
  const data = groups.data;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1 className="doc-title">Groupes</h1>
          <p className="admin-count">
            {data.groups.length} groupe{data.groups.length > 1 ? 's' : ''}
          </p>
        </div>
        <button type="button" className="btn-ink" onClick={() => setNaming({ group: null })}>
          <PlusIcon size={18} aria-hidden />
          Nouveau groupe
        </button>
      </div>
      <p className="admin-intro">Un groupe ouvre des volumes à plusieurs personnes d’un coup, et sert de liste pour restreindre des pages. Ajouter ou retirer quelqu’un change ses accès aussitôt, pages ouvertes comprises.</p>
      {error && <FormError>{error}</FormError>}

      {data.groups.length === 0 ? (
        <p className="muted">Aucun groupe pour l’instant.</p>
      ) : (
        <div className="group-list">
          {data.groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              users={data.users}
              onAdd={(userId) => act(() => api(`/admin/groups/${group.id}/members/${userId}`, { method: 'PUT' }))}
              onRemove={(userId) => act(() => api(`/admin/groups/${group.id}/members/${userId}`, { method: 'DELETE' }))}
              onRename={() => setNaming({ group })}
              onDelete={() =>
                setConfirm({
                  title: `Supprimer le groupe ${group.name} ?`,
                  body:
                    group.volumes.length > 0
                      ? `Ses membres perdent les accès qu’il leur donnait (${group.volumes.map((v) => v.shortName).join(', ')}), sauf ceux qu’ils ont par ailleurs. Les comptes restent.`
                      : 'Les comptes de ses membres restent; seul le groupe disparaît.',
                  action: 'Supprimer',
                  run: async () => {
                    await act(() => api(`/admin/groups/${group.id}`, { method: 'DELETE' }));
                  },
                })
              }
            />
          ))}
        </div>
      )}

      <NameDialog
        naming={naming}
        onClose={() => setNaming(null)}
        onSubmit={async (name) => {
          const group = naming?.group;
          await (group ? api(`/admin/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }) : api('/admin/groups', { method: 'POST', body: JSON.stringify({ name }) }));
          await refresh();
          setNaming(null);
        }}
      />
      <ConfirmDialog confirmation={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function GroupCard({
  group,
  users,
  onAdd,
  onRemove,
  onRename,
  onDelete,
}: {
  group: GroupView;
  users: GroupsOverview['users'];
  onAdd: (userId: string) => Promise<boolean>;
  onRemove: (userId: string) => Promise<boolean>;
  onRename: () => void;
  onDelete: () => void;
}) {
  const inGroup = new Set(group.members.map((m) => m.id));
  const candidates = users.filter((u) => !inGroup.has(u.id)).map((u) => ({ type: 'user' as const, id: u.id, name: u.name, detail: u.email, initials: u.initials, color: u.color }));
  const count = group.members.length;

  return (
    <article className="group-card" aria-labelledby={`group-${group.id}`}>
      <header>
        <span className="grp" aria-hidden>
          <UsersThreeIcon size={20} />
        </span>
        <div>
          <h2 id={`group-${group.id}`}>{group.name}</h2>
          <p className="muted">
            {count} personne{count > 1 ? 's' : ''}
            {group.restrictedPages > 0 && ` · restreint ${group.restrictedPages} page${group.restrictedPages > 1 ? 's' : ''}`}
          </p>
        </div>
        <GroupMenu name={group.name} onRename={onRename} onDelete={onDelete} />
      </header>

      <ul className="chips" aria-label={`Membres de ${group.name}`}>
        {group.members.map((m) => (
          <li key={m.id} className="chip" data-disabled={m.disabled ? 'true' : undefined}>
            <Avatar initials={m.initials} color={m.color} size={22} />
            {m.name}
            {m.disabled && <span className="badge-off">désactivé</span>}
            <button type="button" className="icon-btn xs" aria-label={`Retirer ${m.name} du groupe ${group.name}`} onClick={() => void onRemove(m.id)}>
              <XIcon size={13} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <Picker entries={candidates} label={`Ajouter quelqu’un à ${group.name}`} placeholder="Ajouter quelqu’un…" onPick={(entry) => void onAdd(entry.id)} />

      <div className="group-volumes">
        {group.volumes.length === 0 ? (
          <span className="muted">N’ouvre aucun volume. Ajoutez-le depuis le panneau Partager d’une page du volume.</span>
        ) : (
          group.volumes.map((v) => (
            <span key={v.id} className="vol-tag" data-vol={v.cloth}>
              <span className="vol-swatch" aria-hidden />
              Vol. {v.volumeNumber} {v.shortName} · {VOLUME_ROLE[v.role]}
            </span>
          ))
        )}
      </div>
    </article>
  );
}

function GroupMenu({ name, onRename, onDelete }: { name: string; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="icon-btn sm" aria-label={`Actions pour le groupe ${name}`}>
          <DotsThreeIcon size={20} weight="bold" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop menu" align="end" sideOffset={6} collisionPadding={16}>
          <button type="button" className="menu-item" onClick={run(onRename)}>
            <PencilSimpleIcon size={18} aria-hidden />
            Renommer
          </button>
          <button type="button" className="menu-item danger" onClick={run(onDelete)}>
            <TrashIcon size={18} aria-hidden />
            Supprimer le groupe
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NameDialog({ naming, onClose, onSubmit }: { naming: { group: GroupView | null } | null; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  return (
    <Modal open={naming !== null} onOpenChange={(open) => !open && onClose()} title={naming?.group ? `Renommer ${naming.group.name}` : 'Nouveau groupe'}>
      {naming && <NameForm initial={naming.group?.name ?? ''} creating={!naming.group} onSubmit={onSubmit} />}
    </Modal>
  );
}

function NameForm({ initial, creating, onSubmit }: { initial: string; creating: boolean; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };
  return (
    <form className="dialog-body" onSubmit={(e) => void submit(e)}>
      {error && <FormError>{error}</FormError>}
      <div className="field">
        <label htmlFor="group-name">Nom du groupe</label>
        <input id="group-name" className="input" required autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {creating && <p className="form-hint">Ajoutez ensuite ses membres, puis ouvrez-lui des volumes depuis le panneau Partager.</p>}
      <button type="submit" className="btn-ink" disabled={pending || !name.trim()}>
        {creating ? 'Créer le groupe' : 'Renommer'}
      </button>
    </form>
  );
}
