import { canManageAccounts, type WorkspaceRole } from '@andal/authz';
import { Avatar } from '@andal/ui';
import { CaretRightIcon, DotsThreeIcon, KeyIcon, ProhibitIcon, UserPlusIcon, ArrowCounterClockwiseIcon, XIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { FormError, FormOk } from '../components/AuthCard';
import { CopyField } from '../components/CopyField';
import { Shelf } from '../components/Shelf';
import { api, errorMessage, useAccounts, useMe, useProjects, type AdminInvitation, type AdminUser, type LinkResult } from '../lib/api';
import { GroupsSection } from './GroupsSection';
import { AssistantSection } from './AssistantSection';
import { IntegrationsSection } from './IntegrationsSection';
import { ConfirmDialog, Modal, type Confirmation } from '../components/Dialog';
import { relative, ROLE_HELP, roleLabel, until } from '../lib/format';


interface Issued {
  title: string;
  result: LinkResult;
  /** Ce qu'on dit quand l'email est parti, et quand il faut transmettre le lien. */
  emailedText: string;
  linkText: string;
}

const SECTIONS = { comptes: 'Comptes', groupes: 'Groupes', integrations: 'Intégrations', assistant: 'Assistant' } as const;

/** Administration de l'espace (comptes, groupes): réservée aux propriétaires et admins. */
export function AdminPage({ section }: { section: keyof typeof SECTIONS }) {
  const me = useMe();
  const projects = useProjects();
  const allowed = me.data ? canManageAccounts(me.data.user.workspaceRole as WorkspaceRole) : false;

  useEffect(() => {
    document.title = `${SECTIONS[section]} · Administration · Andal`;
  }, [section]);

  if (!me.data || !projects.data) return null;
  return (
    <div className="app admin-app">
      <div className="nav-wrap">
        <Shelf projects={projects.data} current="" me={me.data} />
      </div>
      <main className="main">
        <header className="band band-admin">
          <div className="band-vol">
            <span className="band-title">Administration</span>
          </div>
          <nav className="crumbs" aria-label="Fil d'Ariane">
            <Link to="/">Documentation</Link>
            <CaretRightIcon size={14} aria-hidden />
            <span aria-current="page">{SECTIONS[section]}</span>
          </nav>
        </header>
        <div className="page">
          <div className="admin-sheet">
            {allowed ? (
              <>
                <nav className="admin-tabs" aria-label="Administration">
                  <Link to="/admin" activeOptions={{ exact: true }} activeProps={{ 'aria-current': 'page' }}>
                    Comptes
                  </Link>
                  <Link to="/admin/groupes" activeProps={{ 'aria-current': 'page' }}>
                    Groupes
                  </Link>
                  <Link to="/admin/integrations" activeProps={{ 'aria-current': 'page' }}>
                    Intégrations
                  </Link>
                  <Link to="/admin/assistant" activeProps={{ 'aria-current': 'page' }}>
                    Assistant
                  </Link>
                </nav>
                {section === 'comptes' ? <Accounts /> : section === 'groupes' ? <GroupsSection /> : section === 'integrations' ? <IntegrationsSection /> : <AssistantSection />}
              </>
            ) : (
              <FormError>Cette page est réservée aux admins de l’espace.</FormError>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Accounts() {
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      await refresh();
    }
  };

  if (accounts.isPending) return <div className="doc-skeleton" aria-busy="true" aria-label="Chargement des comptes"><span /><span /><span /></div>;
  if (accounts.isError) return <FormError>{errorMessage(accounts.error, 'Impossible de charger les comptes.')}</FormError>;
  const data = accounts.data;
  const active = data.users.filter((u) => !u.disabledAt).length;
  const pending = data.invitations.filter((i) => !i.expired).length;

  const resetPassword = (user: AdminUser) =>
    act(async () => {
      const result = await api<LinkResult>(`/admin/accounts/${user.id}/reset-password`, { method: 'POST' });
      setIssued({
        title: `Réinitialiser le mot de passe de ${user.name}`,
        result,
        emailedText: `Un lien a été envoyé à ${user.email}. Il sert une fois et expire dans 24 h; l’ancien mot de passe reste valable d’ici là.`,
        linkText: `Les emails ne partent pas de ce serveur. Transmettez ce lien à ${user.name} par un canal sûr : il sert une fois et expire dans 24 h.`,
      });
    });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1 className="doc-title">Comptes</h1>
          <p className="admin-count">
            {active} actif{active > 1 ? 's' : ''}
            {data.users.length > active && ` · ${data.users.length - active} désactivé${data.users.length - active > 1 ? 's' : ''}`}
            {pending > 0 && ` · ${pending} invitation${pending > 1 ? 's' : ''} en attente`}
          </p>
        </div>
        <button type="button" className="btn-ink" onClick={() => setInviteOpen(true)}>
          <UserPlusIcon size={18} aria-hidden />
          Inviter
        </button>
      </div>
      {error && <FormError>{error}</FormError>}

      <table className="roster">
        <thead>
          <tr>
            <th scope="col">Personne</th>
            <th scope="col">Rôle</th>
            <th scope="col">Connexion</th>
            <th scope="col">Dernière visite</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((user) => (
            <tr key={user.id} data-disabled={user.disabledAt ? 'true' : undefined}>
              <td>
                <span className="person">
                  <Avatar initials={user.initials} color={user.color} size={32} />
                  <span>
                    <b>
                      {user.name}
                      {user.you && <span className="you">vous</span>}
                      {user.disabledAt && <span className="badge-off">Désactivé</span>}
                    </b>
                    <small>
                      {user.email}
                      {user.username && ` · ${user.username}`}
                    </small>
                  </span>
                </span>
              </td>
              <td data-label="Rôle">
                {user.manageable ? (
                  <select
                    className="input select"
                    aria-label={`Rôle de ${user.name}`}
                    value={user.role}
                    onChange={(e) => void act(() => api(`/admin/accounts/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) }))}
                  >
                    {[...new Set([user.role, ...data.assignableRoles])].map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="role-static">{roleLabel(user.role)}</span>
                )}
              </td>
              <td data-label="Connexion">{signIn(user)}</td>
              <td data-label="Dernière visite" className="muted">
                {user.lastLoginAt ? relative(user.lastLoginAt) : 'jamais'}
              </td>
              <td className="actions">
                {user.manageable && (
                  <UserMenu
                    user={user}
                    canReset={data.passwordLogin && !user.disabledAt}
                    onReset={() => void resetPassword(user)}
                    onToggle={() =>
                      user.disabledAt
                        ? void act(() => api(`/admin/accounts/${user.id}/enable`, { method: 'POST' }))
                        : setConfirm({
                            title: `Désactiver ${user.name} ?`,
                            body: 'Cette personne ne pourra plus se connecter, et ses sessions sont fermées tout de suite. Ses pages et commentaires restent. Vous pourrez réactiver le compte.',
                            action: 'Désactiver',
                            run: () => act(() => api(`/admin/accounts/${user.id}/disable`, { method: 'POST' })),
                          })
                    }
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="invites" aria-labelledby="invites-title">
        <h2 id="invites-title">Invitations en attente</h2>
        {data.invitations.length === 0 ? (
          <p className="muted">Aucune. Les invitations acceptées deviennent des comptes ci-dessus.</p>
        ) : (
          <ul>
            {data.invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                onResend={() =>
                  void act(async () => {
                    const result = await api<LinkResult>(`/admin/invitations/${invitation.id}/resend`, { method: 'POST' });
                    setIssued(invitationIssued(invitation.email, result));
                  })
                }
                onRevoke={() =>
                  setConfirm({
                    title: `Révoquer l’invitation de ${invitation.email} ?`,
                    body: 'Le lien envoyé cessera de fonctionner. Vous pourrez réinviter cette adresse plus tard.',
                    action: 'Révoquer',
                    run: () => act(() => api(`/admin/invitations/${invitation.id}`, { method: 'DELETE' })),
                  })
                }
              />
            ))}
          </ul>
        )}
      </section>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={data.assignableRoles}
        groups={data.groups}
        mail={data.mail}
        onInvited={(email, result) => {
          setInviteOpen(false);
          setIssued(invitationIssued(email, result));
          void refresh();
        }}
      />
      <ConfirmDialog confirmation={confirm} onClose={() => setConfirm(null)} />
      <IssuedDialog issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}

function invitationIssued(email: string, result: LinkResult): Issued {
  return {
    title: `Invitation pour ${email}`,
    result,
    emailedText: `Invitation envoyée à ${email}. Le lien expire dans 7 jours. Vous pouvez aussi le transmettre vous-même :`,
    linkText: 'Les emails ne partent pas de ce serveur : transmettez ce lien vous-même. Il expire dans 7 jours.',
  };
}

function signIn(user: AdminUser): string {
  if (user.hasPassword && user.sso) return 'Mot de passe et SSO';
  if (user.sso) return 'SSO';
  if (user.hasPassword) return 'Mot de passe';
  return 'SSO, pas encore lié';
}

function UserMenu({ user, canReset, onReset, onToggle }: { user: AdminUser; canReset: boolean; onReset: () => void; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="icon-btn sm" aria-label={`Actions pour ${user.name}`}>
          <DotsThreeIcon size={20} weight="bold" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop menu" align="end" sideOffset={6} collisionPadding={16}>
          {canReset && (
            <button type="button" className="menu-item" onClick={run(onReset)}>
              <KeyIcon size={18} aria-hidden />
              Réinitialiser le mot de passe
            </button>
          )}
          <button type="button" className={`menu-item${user.disabledAt ? '' : ' danger'}`} onClick={run(onToggle)}>
            {user.disabledAt ? <ArrowCounterClockwiseIcon size={18} aria-hidden /> : <ProhibitIcon size={18} aria-hidden />}
            {user.disabledAt ? 'Réactiver le compte' : 'Désactiver le compte'}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function InvitationRow({ invitation, onResend, onRevoke }: { invitation: AdminInvitation; onResend: () => void; onRevoke: () => void }) {
  return (
    <li data-expired={invitation.expired ? 'true' : undefined}>
      <span>
        <b>{invitation.email}</b>
        <small>
          {invitation.name ? `${invitation.name} · ` : ''}
          {roleLabel(invitation.role)}
          {invitation.groups.length > 0 && ` · ${invitation.groups.join(', ')}`}
          {invitation.invitedBy && ` · invitée par ${invitation.invitedBy}`}
          {' · '}
          {invitation.expired ? 'expirée' : `expire ${until(invitation.expiresAt)}`}
        </small>
      </span>
      {invitation.manageable && (
        <span className="invite-actions">
          <button type="button" className="ghost" onClick={onResend}>
            Nouveau lien
          </button>
          <button type="button" className="ghost danger" onClick={onRevoke}>
            Révoquer
          </button>
        </span>
      )}
    </li>
  );
}


function InviteDialog({
  open,
  onOpenChange,
  roles,
  groups,
  mail,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: WorkspaceRole[];
  groups: { id: string; name: string }[];
  mail: boolean;
  onInvited: (email: string, result: LinkResult) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Inviter une personne">
      {open && <InviteForm roles={roles} groups={groups} mail={mail} onInvited={onInvited} />}
    </Modal>
  );
}

function InviteForm({ roles, groups, mail, onInvited }: { roles: WorkspaceRole[]; groups: { id: string; name: string }[]; mail: boolean; onInvited: (email: string, result: LinkResult) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<WorkspaceRole>(roles.includes('member') ? 'member' : roles[0]!);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<LinkResult>('/admin/invitations', { method: 'POST', body: JSON.stringify({ email, name, role, groupIds }) });
      onInvited(email.trim().toLowerCase(), result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="dialog-body" onSubmit={(e) => void submit(e)}>
      {error && <FormError>{error}</FormError>}
      <div className="field">
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="invite-name">
          Nom <span className="optional">facultatif</span>
        </label>
        <input id="invite-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <fieldset className="role-choice">
        <legend>Rôle dans l’espace</legend>
        {roles.map((r) => (
          <label key={r} className="role-option">
            <input type="radio" name="invite-role" value={r} checked={role === r} onChange={() => setRole(r)} />
            <span>
              <b>{roleLabel(r)}</b>
              <small>{ROLE_HELP[r]}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {groups.length > 0 && (
        <fieldset className="role-choice">
          <legend>
            Groupes <span className="optional">facultatif</span>
          </legend>
          <p className="form-hint">Ses volumes s’ouvrent dès l’inscription.</p>
          <div className="check-grid">
            {groups.map((g) => (
              <label key={g.id} className="check">
                <input type="checkbox" checked={groupIds.includes(g.id)} onChange={(e) => setGroupIds((ids) => (e.target.checked ? [...ids, g.id] : ids.filter((id) => id !== g.id)))} />
                {g.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="form-hint">{mail ? 'Un email avec le lien d’inscription part tout de suite.' : 'Ce serveur n’envoie pas d’email : vous obtiendrez un lien à transmettre.'}</p>
      <button type="submit" className="btn-ink" disabled={pending}>
        {pending ? 'Envoi…' : 'Envoyer l’invitation'}
      </button>
    </form>
  );
}


function IssuedDialog({ issued, onClose }: { issued: Issued | null; onClose: () => void }) {
  return (
    <Modal open={issued !== null} onOpenChange={(open) => !open && onClose()} title={issued?.title ?? ''}>
      {issued && (
        <div className="dialog-body">
          {issued.result.emailed ? <FormOk>{issued.emailedText}</FormOk> : <p className="dialog-text">{issued.linkText}</p>}
          {issued.result.link && <CopyField label="Lien à transmettre" value={issued.result.link} />}
          <Dialog.Close className="btn-ink">Terminé</Dialog.Close>
        </div>
      )}
    </Modal>
  );
}

