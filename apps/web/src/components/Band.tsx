import { Avatar, accessLabel } from '@andal/ui';
import { BookOpenIcon, CaretRightIcon, MoonIcon, PencilSimpleIcon, SunIcon } from '@phosphor-icons/react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { Link } from '@tanstack/react-router';
import type { PresenceUser } from '../editor/DocEditor';
import type { PageDetail } from '../lib/api';
import { t, tn } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { ExportMenu } from './ExportMenu';
import { SharePanel } from './SharePanel';

interface Props {
  page: PageDetail;
  editing: boolean;
  canEdit: boolean;
  presence: PresenceUser[];
  onMode: (editing: boolean) => void;
}

/** Le bandeau du volume: titre, fil d'Ariane, présence, Lire/Modifier, Partager. */
export function Band({ page, editing, canEdit, presence, onMode }: Props) {
  const { theme, toggle } = useTheme();
  return (
    <header className="band">
      <div className="band-vol">
        <span className="band-title">{page.project.name}</span>
        <span className="band-meta">{tn(page.project.pageCount, 'Vol. {vol} · {n} page', 'Vol. {vol} · {n} pages', { vol: page.project.volumeNumber })}</span>
      </div>
      <nav className="crumbs" aria-label={t("Fil d'Ariane")}>
        {page.breadcrumb.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-1.5">
            <Link to="/v/$slug/$pageId" params={{ slug: page.project.slug, pageId: crumb.id }}>
              {crumb.number} {crumb.title}
            </Link>
            <CaretRightIcon size={14} aria-hidden />
          </span>
        ))}
        <span aria-current="page">
          {page.number} {page.title}
        </span>
      </nav>
      <div className="band-actions">
        <div className="presence" aria-label={tn(presence.length, '{n} personne sur cette page', '{n} personnes sur cette page')}>
          {presence.slice(0, 4).map((p) => (
            <Avatar key={p.clientId} initials={initials(p.name)} color={p.color} title={p.name} />
          ))}
        </div>
        <ToggleGroup.Root
          type="single"
          className="seg"
          aria-label={t('Mode de la page')}
          value={editing ? 'edit' : 'read'}
          onValueChange={(v) => v && onMode(v === 'edit')}
        >
          <ToggleGroup.Item value="read">
            <BookOpenIcon size={16} aria-hidden />
            {t('Lire')}
          </ToggleGroup.Item>
          <ToggleGroup.Item value="edit" disabled={!canEdit} title={canEdit ? undefined : t('Votre droit sur cette page: {access}', { access: t(accessLabel(page.role === 'commenter' ? 'comment' : 'read')).toLowerCase() })}>
            <PencilSimpleIcon size={16} aria-hidden />
            {t('Modifier')}
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        <SharePanel page={page} />
        <ExportMenu page={page} />
        <button type="button" className="icon-btn on-band" onClick={toggle} aria-label={theme === 'dark' ? t('Passer en thème clair') : t('Passer en thème sombre')}>
          {theme === 'dark' ? <SunIcon size={18} aria-hidden /> : <MoonIcon size={18} aria-hidden />}
        </button>
      </div>
    </header>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
