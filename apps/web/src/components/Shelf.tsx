import { canManageAccounts, type WorkspaceRole } from '@andal/authz';
import { Avatar } from '@andal/ui';
import { ArchiveIcon, BooksIcon, KeyIcon, PlusIcon, SignOutIcon, UsersThreeIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, type Me, type ProjectSummary } from '../lib/api';
import { roleLabel } from '../lib/format';
import { spineHeight, volumeLink } from '../lib/volumes';
import { Logo } from './Logo';
import { NotificationsButton } from './NotificationsButton';
import { PasswordDialog } from './PasswordDialog';
import { ArchivesDialog, NewVolumeDialog } from './VolumeDialogs';

/**
 * L'étagère: vos volumes épinglés, un dos par volume, dans l'ordre des
 * numéros. Le volume ouvert s'y ajoute le temps de la visite s'il n'y est
 * pas; tous les autres attendent dans la bibliothèque.
 */
export function Shelf({ projects, current, me, library = false }: { projects: ProjectSummary[]; current: string; me: Me; library?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [archivesOpen, setArchivesOpen] = useState(false);
  // Les invités ne créent pas de volume (voir canCreateProject).
  const member = me.user.workspaceRole !== 'guest';
  const spines = useRef<HTMLDivElement>(null);
  const shelved = projects.filter((p) => p.pinned);
  const visiting = projects.find((p) => p.slug === current && !p.pinned);

  // Le volume ouvert reste en vue quand l'étagère défile.
  useEffect(() => {
    spines.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, projects.length]);

  const logout = async () => {
    const { redirectTo } = await api<{ redirectTo: string | null }>('/auth/logout', { method: 'POST' });
    queryClient.clear();
    // Après un SSO, le fournisseur ferme aussi sa session puis renvoie vers /login.
    if (redirectTo) window.location.assign(redirectTo);
    else await navigate({ to: '/login' });
  };

  return (
    <aside className="shelf" aria-label="Volumes">
      <a className="logo" href="/" aria-label="Andal, bibliothèque">
        <Logo />
      </a>
      <Link to="/" className="shelf-library" aria-current={library ? 'page' : undefined} aria-label={`Bibliothèque: les ${projects.length} volumes`} title="Bibliothèque: tous les volumes">
        <BooksIcon size={20} aria-hidden />
      </Link>
      <div className="spines" role="list" aria-label="Votre étagère" ref={spines}>
        {shelved.map((p) => (
          <Spine key={p.id} volume={p} current={p.slug === current} />
        ))}
        {visiting && (
          <>
            <span className="spines-gap" role="presentation" />
            <Spine volume={visiting} current visiting />
          </>
        )}
        {member && (
          <button type="button" className="spine-add" aria-label="Nouveau volume" title="Nouveau volume" onClick={() => setNewOpen(true)}>
            <PlusIcon size={18} aria-hidden />
          </button>
        )}
      </div>
      <NewVolumeDialog open={newOpen} onOpenChange={setNewOpen} projects={projects} />
      <ArchivesDialog open={archivesOpen} onOpenChange={setArchivesOpen} />
      <div className="shelf-foot">
        <NotificationsButton />
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <button type="button" aria-label={`Compte de ${me.user.name}`}>
              <Avatar initials={me.user.initials} color={me.user.color} size={32} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="pop account" side="right" align="end" sideOffset={10} collisionPadding={16}>
              <div className="account-head">
                <b>{me.user.name}</b>
                <small>
                  {me.user.username ?? me.user.email} · {roleLabel(me.user.workspaceRole)}
                </small>
                <small>{me.auth.method === 'oidc' ? 'Connecté par SSO' : 'Connecté par mot de passe'}</small>
              </div>
              {canManageAccounts(me.user.workspaceRole as WorkspaceRole) && (
                <Link to="/admin" className="menu-item" onClick={() => setMenuOpen(false)}>
                  <UsersThreeIcon size={18} aria-hidden />
                  Gérer les comptes et les groupes
                </Link>
              )}
              {member && (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setArchivesOpen(true);
                  }}
                >
                  <ArchiveIcon size={18} aria-hidden />
                  Volumes archivés
                </button>
              )}
              {me.user.hasPassword && (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setPasswordOpen(true);
                  }}
                >
                  <KeyIcon size={18} aria-hidden />
                  Changer le mot de passe
                </button>
              )}
              <button type="button" className="menu-item" onClick={() => void logout()}>
                <SignOutIcon size={18} aria-hidden />
                Se déconnecter
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      </div>
    </aside>
  );
}

/** Un dos: la toile du volume, son numéro, son nom court écrit de bas en haut. */
function Spine({ volume, current, visiting = false }: { volume: ProjectSummary; current: boolean; visiting?: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      role="listitem"
      className="spine"
      data-vol={volume.cloth}
      data-visiting={visiting || undefined}
      aria-current={current ? 'true' : undefined}
      aria-label={`Volume ${volume.volumeNumber}, ${volume.name}${visiting ? ', pas sur votre étagère' : ''}`}
      title={visiting ? `${volume.name}: ouvert, mais pas sur votre étagère` : volume.name}
      style={{ '--h': spineHeight(volume.shortName) } as CSSProperties}
      onClick={() => void navigate(volumeLink(volume))}
    >
      <b className="spine-num" aria-hidden>
        {volume.volumeNumber}
      </b>
      <span className="spine-label" aria-hidden>
        {volume.shortName}
      </span>
    </button>
  );
}
