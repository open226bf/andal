import { Avatar } from '@andal/ui';
import { DownloadSimpleIcon, IdentificationCardIcon, RobotIcon } from '@phosphor-icons/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { FormError } from '../components/AuthCard';
import { api, errorMessage, type AuditEvent, type AuditPage } from '../lib/api';
import { dateTime } from '../lib/format';
import { t } from '../lib/i18n';

/** Ce que dit chaque action, au passé, sans jargon. Une action inconnue s'affiche telle quelle. */
const ACTIONS: Record<string, string> = {
  'auth.login': t('Connexion'),
  'auth.login_failed': t('Échec de connexion'),
  'auth.logout': t('Déconnexion'),
  'auth.mfa_failed': t('Code de vérification refusé'),
  'auth.mfa_enabled': t('Double authentification activée'),
  'auth.mfa_disabled': t('Double authentification désactivée'),
  'auth.recovery_code_used': t('Code de secours utilisé'),
  'auth.recovery_codes_regenerated': t('Nouveaux codes de secours'),
  'auth.session_closed': t('Session fermée'),
  'auth.sessions_closed': t('Autres sessions fermées'),
  'auth.password_changed': t('Mot de passe changé'),
  'auth.password_reset': t('Mot de passe réinitialisé'),
  'auth.password_reset_requested': t('Mot de passe oublié'),
  'auth.oidc_linked': t('Identité SSO liée'),
  'auth.oidc_provisioned': t('Compte créé par le SSO'),
  'auth.sso_groups_synced': t('Groupes SSO mis à jour'),
  'account.invited': t('Invitation envoyée'),
  'account.invitation_resent': t('Invitation renvoyée'),
  'account.invitation_revoked': t('Invitation révoquée'),
  'account.invitation_accepted': t('Invitation acceptée'),
  'account.role_changed': t('Rôle changé'),
  'account.disabled': t('Compte désactivé'),
  'account.enabled': t('Compte réactivé'),
  'account.password_reset_issued': t('Lien de mot de passe envoyé'),
  'account.mfa_reset': t('Double authentification levée'),
  'account.sessions_closed': t('Sessions fermées par un admin'),
  'group.created': t('Groupe créé'),
  'group.renamed': t('Groupe renommé'),
  'group.deleted': t('Groupe supprimé'),
  'group.member_added': t('Membre ajouté'),
  'group.member_removed': t('Membre retiré'),
  'access.grant_added': t('Accès au volume donné'),
  'access.grant_changed': t('Accès au volume changé'),
  'access.grant_removed': t('Accès au volume retiré'),
  'access.restriction_added': t('Page restreinte'),
  'access.restriction_changed': t('Restriction modifiée'),
  'access.restriction_lifted': t('Restriction levée'),
  'project.created': t('Volume créé'),
  'project.updated': t('Volume modifié'),
  'project.archived': t('Volume archivé'),
  'project.unarchived': t('Volume désarchivé'),
  'project.deleted': t('Volume supprimé'),
  'page.created': t('Page créée'),
  'page.updated': t('Page renommée'),
  'page.moved': t('Page déplacée'),
  'page.deleted': t('Page à la corbeille'),
  'page.restored': t('Page restaurée'),
  'page.purged': t('Page supprimée'),
  'page.purged_automatically': t('Corbeille vidée'),
  'page.version_restored': t('Version restaurée'),
  'page.content_replaced': t('Contenu remplacé par l’API'),
  'comment.thread_created': t('Fil ouvert'),
  'comment.replied': t('Réponse'),
  'comment.thread_resolved': t('Fil résolu'),
  'comment.thread_reopened': t('Fil rouvert'),
  'comment.deleted': t('Commentaire supprimé'),
  'comment.thread_deleted': t('Fil supprimé'),
  'file.uploaded': t('Fichier envoyé'),
  'rayon.created': t('Rayon créé'),
  'rayon.renamed': t('Rayon renommé'),
  'rayon.reordered': t('Rayons réordonnés'),
  'rayon.deleted': t('Rayon supprimé'),
  'spec.published': t('Spec publiée'),
  'spec.deleted': t('Spec supprimée'),
  'token.created': t('Jeton d’API créé'),
  'token.revoked': t('Jeton d’API révoqué'),
  'webhook.created': t('Webhook créé'),
  'webhook.updated': t('Webhook modifié'),
  'webhook.deleted': t('Webhook supprimé'),
  'webhook.secret_rotated': t('Secret de webhook renouvelé'),
  'git.created': t('Dépôt Git relié'),
  'git.updated': t('Synchro Git modifiée'),
  'git.deleted': t('Dépôt Git détaché'),
  'ai.question': t('Question à l’assistant'),
  'ai.settings_updated': t('Assistant réglé'),
  'scim.token_created': t('Jeton SCIM créé'),
  'scim.token_rotated': t('Jeton SCIM remplacé'),
  'scim.token_revoked': t('Jeton SCIM révoqué'),
  'scim.user_created': t('Compte provisionné'),
  'scim.user_updated': t('Compte mis à jour par l’annuaire'),
  'scim.user_deactivated': t('Compte désactivé par l’annuaire'),
  'scim.user_reactivated': t('Compte réactivé par l’annuaire'),
  'scim.user_deleted': t('Compte retiré par l’annuaire'),
  'scim.group_created': t('Groupe provisionné'),
  'scim.group_updated': t('Groupe mis à jour par l’annuaire'),
  'scim.group_deleted': t('Groupe retiré par l’annuaire'),
};

const FAMILIES: [string, string][] = [
  ['auth.', t('Connexions et sécurité')],
  ['account.', t('Comptes')],
  ['group.', t('Groupes')],
  ['access.', t('Accès et restrictions')],
  ['project.', t('Volumes')],
  ['page.', t('Pages')],
  ['comment.', t('Commentaires')],
  ['file.', t('Fichiers')],
  ['rayon.', t('Rayons')],
  ['spec.', t('Specs')],
  ['token.', t('Jetons d’API')],
  ['webhook.', t('Webhooks')],
  ['git.', t('Synchro Git')],
  ['ai.', t('Assistant')],
  ['scim.', t('Annuaire (SCIM)')],
];

export const actionLabel = (action: string) => ACTIONS[action] ?? action;

/** Les actions sensibles ressortent: échecs, levées, retraits. */
const ALERT = /failed|mfa_disabled|mfa_reset|disabled|deleted|revoked|purged|restriction_lifted|grant_removed/;

interface Filters {
  action: string;
  actor: string;
  from: string;
  to: string;
}

function params(filters: Filters, before?: string | null): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) p.set(key, value);
  if (before) p.set('before', before);
  return p.toString();
}

function Who({ event }: { event: AuditEvent }) {
  if (event.actor)
    return (
      <span className="person">
        <Avatar initials={event.actor.initials} color={event.actor.color} size={24} />
        <span>{event.actor.name}</span>
      </span>
    );
  const scim = event.metadata.via === 'scim';
  return (
    <span className="person system">
      <span className="system-icon" aria-hidden>
        {scim ? <IdentificationCardIcon size={16} /> : <RobotIcon size={16} />}
      </span>
      <span>{scim ? t('Annuaire (SCIM)') : event.action === 'auth.login_failed' || event.action === 'auth.mfa_failed' ? t('Inconnu') : 'Andal'}</span>
    </span>
  );
}

/**
 * Le journal d'audit de l'espace: qui a fait quoi, sur quoi, d'où. En ajout
 * seul côté base; filtré ici, exporté en CSV pour un audit ou un SIEM.
 */
export function AuditSection() {
  const [filters, setFilters] = useState<Filters>({ action: '', actor: '', from: '', to: '' });
  const journal = useInfiniteQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: ({ pageParam }) => api<AuditPage>(`/admin/audit?${params(filters, pageParam)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });
  // Les choix des filtres: toutes les actions déjà vues et tous les comptes, quels que soient les filtres posés.
  const meta = useQuery({ queryKey: ['admin', 'audit', 'meta'], queryFn: () => api<AuditPage>('/admin/audit?limit=1') });
  const known = meta.data ? { actions: meta.data.actions ?? [], people: meta.data.people } : null;
  const events = useMemo(() => journal.data?.pages.flatMap((p) => p.events) ?? [], [journal.data]);
  const set = (key: keyof Filters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <>
      <div className="admin-head">
        <div>
          <h1 className="doc-title">{t('Journal')}</h1>
          <p className="admin-count">{t('Chaque connexion, changement d’accès et modification de l’espace, du plus récent au plus ancien. Personne, pas même un admin, ne peut l’effacer.')}</p>
        </div>
        <a className="btn-line" href={`/api/admin/audit/export?${params(filters)}`} download>
          <DownloadSimpleIcon size={18} aria-hidden />
          {t('Exporter en CSV')}
        </a>
      </div>

      <form className="audit-filters" role="search" aria-label={t('Filtrer le journal')} onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="audit-action">{t('Action')}</label>
          <select id="audit-action" className="input select" value={filters.action} onChange={(e) => set('action')(e.target.value)}>
            <option value="">{t('Toutes')}</option>
            {FAMILIES.filter(([prefix]) => !known || known.actions.some((a) => a.startsWith(prefix))).map(([prefix, label]) => (
              <optgroup key={prefix} label={label}>
                <option value={prefix}>{t('{family}: tout', { family: label })}</option>
                {(known?.actions ?? [])
                  .filter((a) => a.startsWith(prefix))
                  .map((a) => (
                    <option key={a} value={a}>
                      {actionLabel(a)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-actor">{t('Qui')}</label>
          <select id="audit-actor" className="input select" value={filters.actor} onChange={(e) => set('actor')(e.target.value)}>
            <option value="">{t('Tout le monde')}</option>
            {(known?.people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-from">{t('Du')}</label>
          <input id="audit-from" type="date" className="input" value={filters.from} max={filters.to || undefined} onChange={(e) => set('from')(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="audit-to">{t('Au')}</label>
          <input id="audit-to" type="date" className="input" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to')(e.target.value)} />
        </div>
        {(filters.action || filters.actor || filters.from || filters.to) && (
          <button type="button" className="ghost audit-clear" onClick={() => setFilters({ action: '', actor: '', from: '', to: '' })}>
            {t('Effacer les filtres')}
          </button>
        )}
      </form>

      {journal.isError && <FormError>{errorMessage(journal.error, t('Impossible de lire le journal.'))}</FormError>}
      {journal.isPending ? (
        <div className="doc-skeleton" aria-busy="true" aria-label={t('Chargement du journal')}>
          <span />
          <span />
          <span />
        </div>
      ) : events.length === 0 ? (
        <p className="hooks-empty">{t('Rien ne correspond à ces filtres.')}</p>
      ) : (
        <table className="roster audit">
          <thead>
            <tr>
              <th scope="col">{t('Quand')}</th>
              <th scope="col">{t('Qui')}</th>
              <th scope="col">{t('Quoi')}</th>
              <th scope="col">{t('Sur')}</th>
              <th scope="col">{t('Adresse IP')}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} data-alert={ALERT.test(event.action) || undefined}>
                <td data-label={t('Quand')} className="muted audit-when">
                  <time dateTime={event.at}>{dateTime(event.at)}</time>
                </td>
                <td data-label={t('Qui')}>
                  <Who event={event} />
                </td>
                <td data-label={t('Quoi')}>
                  <span className="audit-action" title={event.action}>
                    {actionLabel(event.action)}
                  </span>
                </td>
                <td data-label={t('Sur')}>
                  {event.target.href ? (
                    <Link to={event.target.href} className="audit-target">
                      {event.target.label ?? event.target.type}
                    </Link>
                  ) : (
                    <span className="audit-target">{event.target.label ?? <span className="muted">{event.target.type}</span>}</span>
                  )}
                </td>
                <td data-label={t('Adresse IP')} className="muted">
                  <code className="audit-ip">{event.ip ?? '—'}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {journal.hasNextPage && (
        <div className="audit-more">
          <button type="button" className="btn-line" disabled={journal.isFetchingNextPage} onClick={() => void journal.fetchNextPage()}>
            {journal.isFetchingNextPage ? t('Chargement…') : t('Plus ancien')}
          </button>
        </div>
      )}
    </>
  );
}
