import { Avatar } from '@andal/ui';
import { DotsThreeIcon, PencilSimpleIcon, PlusIcon, TrashIcon, UsersThreeIcon, XIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError } from '../components/AuthCard';
import { Picker } from '../components/Picker';
import { api, errorMessage, useGroups, type GroupView, type GroupsOverview } from '../lib/api';
import { ConfirmDialog, Modal, type Confirmation } from '../components/Dialog';
import { t, tn } from '../lib/i18n';

const VOLUME_ROLE: Record<string, string> = { reader: t('lecture'), commenter: t('commentaire'), editor: t('écriture'), admin: t('admin') };

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

  if (groups.isPending) return <div className="doc-skeleton" aria-busy="true" aria-label={t('Chargement des groupes')}><span /><span /><span /></div>;
  if (groups.isError) return <FormError>{errorMessage(groups.error, t('Impossible de charger les groupes.'))}</FormError>;
  const data = groups.data;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1 className="doc-title">{t('Groupes')}</h1>
          <p className="admin-count">
            {tn(data.groups.length, '{n} groupe', '{n} groupes')}
          </p>
        </div>
        <button type="button" className="btn-ink" onClick={() => setNaming({ group: null })}>
          <PlusIcon size={18} aria-hidden />
          {t('Nouveau groupe')}
        </button>
      </div>
      <p className="admin-intro">{t('Un groupe ouvre des volumes à plusieurs personnes d’un coup, et sert de liste pour restreindre des pages. Ajouter ou retirer quelqu’un change ses accès aussitôt, pages ouvertes comprises.')}</p>
      {error && <FormError>{error}</FormError>}

      {data.groups.length === 0 ? (
        <p className="muted">{t('Aucun groupe pour l’instant.')}</p>
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
                  title: t('Supprimer le groupe {name} ?', { name: group.name }),
                  body:
                    group.volumes.length > 0
                      ? t('Ses membres perdent les accès qu’il leur donnait ({volumes}), sauf ceux qu’ils ont par ailleurs. Les comptes restent.', { volumes: group.volumes.map((v) => v.shortName).join(', ') })
                      : t('Les comptes de ses membres restent; seul le groupe disparaît.'),
                  action: t('Supprimer'),
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
  // Un groupe du fournisseur d'identité se lit ici, il se gère là-bas.
  const managed = group.source !== 'local';
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
          <h2 id={`group-${group.id}`}>
            {group.name}
            {managed && <span className="group-source">{group.source === 'scim' ? 'SCIM' : 'SSO'}</span>}
          </h2>
          <p className="muted">
            {tn(count, '{n} personne', '{n} personnes')}
            {managed && ` · ${group.source === 'scim' ? t('tenu par l’annuaire (SCIM)') : t('tenu par le SSO, à chaque connexion')}`}
            {group.restrictedPages > 0 && ` · ${tn(group.restrictedPages, 'restreint {n} page', 'restreint {n} pages')}`}
          </p>
        </div>
        {group.source === 'local' ? <GroupMenu name={group.name} onRename={onRename} onDelete={onDelete} /> : group.source === 'sso' && <GroupMenu name={group.name} onDelete={onDelete} />}
      </header>

      <ul className="chips" aria-label={t('Membres de {name}', { name: group.name })}>
        {group.members.map((m) => (
          <li key={m.id} className="chip" data-disabled={m.disabled ? 'true' : undefined}>
            <Avatar initials={m.initials} color={m.color} size={22} />
            {m.name}
            {m.disabled && <span className="badge-off">{t('désactivé')}</span>}
            {!managed && (
              <button type="button" className="icon-btn xs" aria-label={t('Retirer {member} du groupe {group}', { member: m.name, group: group.name })} onClick={() => void onRemove(m.id)}>
                <XIcon size={13} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!managed && <Picker entries={candidates} label={t('Ajouter quelqu’un à {name}', { name: group.name })} placeholder={t('Ajouter quelqu’un…')} onPick={(entry) => void onAdd(entry.id)} />}

      <div className="group-volumes">
        {group.volumes.length === 0 ? (
          <span className="muted">{t('N’ouvre aucun volume. Ajoutez-le depuis le panneau Partager d’une page du volume.')}</span>
        ) : (
          group.volumes.map((v) => (
            <span key={v.id} className="vol-tag" data-vol={v.cloth}>
              <span className="vol-swatch" aria-hidden />
              {t('Vol. {n} {name} · {role}', { n: v.volumeNumber, name: v.shortName, role: VOLUME_ROLE[v.role] })}
            </span>
          ))
        )}
      </div>
    </article>
  );
}

function GroupMenu({ name, onRename, onDelete }: { name: string; onRename?: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="icon-btn sm" aria-label={t('Actions pour le groupe {name}', { name })}>
          <DotsThreeIcon size={20} weight="bold" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop menu" align="end" sideOffset={6} collisionPadding={16}>
          {onRename && (
            <button type="button" className="menu-item" onClick={run(onRename)}>
              <PencilSimpleIcon size={18} aria-hidden />
              {t('Renommer')}
            </button>
          )}
          <button type="button" className="menu-item danger" onClick={run(onDelete)}>
            <TrashIcon size={18} aria-hidden />
            {t('Supprimer le groupe')}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NameDialog({ naming, onClose, onSubmit }: { naming: { group: GroupView | null } | null; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  return (
    <Modal open={naming !== null} onOpenChange={(open) => !open && onClose()} title={naming?.group ? t('Renommer {name}', { name: naming.group.name }) : t('Nouveau groupe')}>
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
        <label htmlFor="group-name">{t('Nom du groupe')}</label>
        <input id="group-name" className="input" required autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {creating && <p className="form-hint">{t('Ajoutez ensuite ses membres, puis ouvrez-lui des volumes depuis le panneau Partager.')}</p>}
      <button type="submit" className="btn-ink" disabled={pending || !name.trim()}>
        {creating ? t('Créer le groupe') : t('Renommer')}
      </button>
    </form>
  );
}
