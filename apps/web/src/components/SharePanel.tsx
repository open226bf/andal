import { AccessMark, accessLevel, accessLabel, type Role } from '@andal/ui';
import { LockSimpleIcon, LockSimpleOpenIcon, UsersThreeIcon, XIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api, errorMessage, useSharing, type DirectoryEntry, type PageDetail, type PrincipalView, type Sharing } from '../lib/api';
import { FormError } from './AuthCard';
import { EntryMark, Picker } from './Picker';

const GRANT_ROLES: { role: Role; label: string }[] = [
  { role: 'reader', label: 'Lecture' },
  { role: 'commenter', label: 'Commentaire' },
  { role: 'editor', label: 'Écriture' },
  { role: 'admin', label: 'Admin du volume' },
];

const KIND_LABEL = { view: 'Lecture', edit: 'Écriture' } as const;

type Kind = 'view' | 'edit';
type Ref = { type: 'user' | 'group'; id: string };

const key = (p: Ref) => `${p.type}:${p.id}`;

/** Bouton Partager du bandeau: qui accède au volume et à la page, et, selon ses droits, le modifier. */
export function SharePanel({ page }: { page: PageDetail }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn-paper">
          <UsersThreeIcon size={16} aria-hidden />
          Partager
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="pop share"
          align="end"
          sideOffset={10}
          collisionPadding={16}
          // Échap dans un champ de recherche vide d'abord ce champ, sans fermer le panneau.
          onEscapeKeyDown={(e) => {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement && active.closest('.picker') && active.value) e.preventDefault();
          }}
        >
          <ShareContent page={page} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ShareContent({ page }: { page: PageDetail }) {
  const { data, isPending } = useSharing(page.id, true);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const act = async (run: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    let ok = true;
    try {
      await run();
    } catch (err) {
      setError(errorMessage(err));
      ok = false;
    }
    // Le colophon, le sommaire et l'étagère dépendent aussi des droits.
    await Promise.all(['sharing', 'page', 'tree', 'projects'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    return ok;
  };

  return (
    <>
      <div className="pop-head">
        <h2>
          Partager « {page.number} {page.title} »
        </h2>
        <Popover.Close className="icon-btn sm" aria-label="Fermer">
          <XIcon size={18} aria-hidden />
        </Popover.Close>
      </div>
      {error && (
        <div className="share-error">
          <FormError>{error}</FormError>
        </div>
      )}
      {!data ? (
        <ul className="members" aria-busy={isPending} />
      ) : (
        <>
          <VolumeSection data={data} act={act} />
          <PageSection data={data} act={act} pageId={page.id} slug={page.project.slug} />
        </>
      )}
    </>
  );
}

function VolumeSection({ data, act }: { data: Sharing; act: (run: () => Promise<unknown>) => Promise<boolean> }) {
  const [role, setRole] = useState<Role>('reader');
  const present = new Set(data.grants.map((g) => key(g.principal)));
  const candidates = (data.directory ?? []).filter((e) => !present.has(key(e)));
  const grant = (p: Ref, r: Role) => act(() => api(`/projects/${data.projectId}/grants`, { method: 'PUT', body: JSON.stringify({ type: p.type, id: p.id, role: r }) }));

  return (
    <section className="share-sec" aria-labelledby="share-volume">
      <h3 id="share-volume">
        Volume {data.project.shortName}
        <small>Ce que chacun peut faire sur toutes les pages du volume.</small>
      </h3>
      <ul className="members">
        {data.grants.length === 0 && <li className="members-empty">Personne en dehors des admins de l’espace.</li>}
        {data.grants.map(({ principal, role: current }) => (
          <li key={key(principal)}>
            <EntryMark entry={principal} size={32} />
            <span>
              <b>
                {principal.name}
                {principal.you && <span className="you">vous</span>}
                {principal.guest && <span className="badge-guest">invité</span>}
              </b>
              <small>{principal.type === 'group' ? `Groupe · ${principal.members ?? 0} personne(s)` : 'Accès direct'}</small>
            </span>
            {data.canShare ? (
              <>
                <select className="input select sm" aria-label={`Rôle de ${principal.name} sur le volume`} value={current} onChange={(e) => void grant(principal, e.target.value as Role)}>
                  {GRANT_ROLES.filter((r) => !(principal.guest && r.role === 'admin')).map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn xs"
                  aria-label={`Retirer ${principal.name} du volume`}
                  title="Retirer du volume"
                  onClick={() => void act(() => api(`/projects/${data.projectId}/grants/${principal.type}/${principal.id}`, { method: 'DELETE' }))}
                >
                  <XIcon size={15} aria-hidden />
                </button>
              </>
            ) : (
              <span className="role">
                <AccessMark level={accessLevel(current)} />
                {current === 'admin' ? 'Admin' : accessLabel(accessLevel(current))}
              </span>
            )}
          </li>
        ))}
      </ul>
      {data.canShare && (
        <div className="share-add">
          <Picker
            entries={candidates}
            label="Ajouter au volume"
            placeholder="Ajouter une personne ou un groupe…"
            onPick={(entry) => void grant(entry, (entry as DirectoryEntry).guest && role === 'admin' ? 'editor' : role)}
          />
          <select className="input select" aria-label="Rôle donné aux personnes ajoutées" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {GRANT_ROLES.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="share-note">Les admins et propriétaires de l’espace administrent tous les volumes. Un invité ne dépasse jamais l’écriture.</p>
    </section>
  );
}

function PageSection({ data, act, pageId, slug }: { data: Sharing; act: (run: () => Promise<unknown>) => Promise<boolean>; pageId: string; slug: string }) {
  const save = (kind: Kind, list: Ref[]) => act(() => api(`/pages/${pageId}/restrictions/${kind}`, { method: 'PUT', body: JSON.stringify({ principals: list.map((p) => ({ type: p.type, id: p.id })) }) }));
  return (
    <section className="share-sec" aria-labelledby="share-page">
      <h3 id="share-page">
        Cette page
        <small>Réserver la lecture ou l’écriture à quelques personnes ou groupes du volume.</small>
      </h3>
      {data.inheritedRestrictions.map((r) => (
        <p key={`${r.page.id}:${r.kind}`} className="share-inherited">
          <LockSimpleIcon size={16} aria-hidden />
          <span>
            {KIND_LABEL[r.kind]} réservée à {names(r.principals)} par{' '}
            <Link to="/v/$slug/$pageId" params={{ slug, pageId: r.page.id }}>
              {r.page.number} {r.page.title}
            </Link>
            , et donc à ses sous-pages.
          </span>
        </p>
      ))}
      <Restriction kind="view" current={data.pageRestrictions.view} data={data} onSave={(list) => save('view', list)} />
      <Restriction kind="edit" current={data.pageRestrictions.edit} data={data} onSave={(list) => save('edit', list)} />
      <p className="share-note">Une restriction réduit les droits du volume, elle ne les élargit jamais. Elle s’applique aussi aux sous-pages.</p>
      {!data.canShare && !data.canRestrict && <p className="share-note">Seuls les admins du volume et les personnes qui peuvent écrire sur la page modifient ces accès.</p>}
    </section>
  );
}

/** Une restriction (lecture ou écriture) de la page: la liste, et de quoi la modifier. */
function Restriction({ kind, current, data, onSave }: { kind: Kind; current: PrincipalView[]; data: Sharing; onSave: (list: Ref[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState<PrincipalView[] | null>(null);
  const restricted = current.length > 0;
  const editable = data.canRestrict;
  const list = draft ?? current;
  const present = new Set(list.map(key));
  const candidates = (data.directory ?? []).filter((e) => !present.has(key(e)));

  // Une restriction en place se modifie aussitôt; une nouvelle se prépare, puis se confirme.
  const change = async (next: PrincipalView[]) => {
    if (draft) setDraft(next);
    else await onSave(next);
  };

  const start = () => {
    const me = data.directory?.find((e) => e.type === 'user' && e.you);
    setDraft(me ? [me] : []);
  };

  return (
    <div className="restriction" data-on={restricted || draft ? 'true' : undefined}>
      <div className="restriction-head">
        {restricted ? <LockSimpleIcon size={16} aria-hidden /> : <LockSimpleOpenIcon size={16} aria-hidden />}
        <b>{restricted || draft ? `${KIND_LABEL[kind]} réservée à` : `${KIND_LABEL[kind]} : tout le volume`}</b>
        {editable && !restricted && !draft && (
          <button type="button" className="ghost" onClick={start}>
            {kind === 'view' ? 'Réserver la lecture…' : 'Réserver l’écriture…'}
          </button>
        )}
        {editable && restricted && !draft && (
          <button type="button" className="ghost" onClick={() => void onSave([])}>
            Lever la restriction
          </button>
        )}
      </div>
      {(restricted || draft) && (
        <ul className="chips">
          {list.map((p) => (
            <li key={key(p)} className="chip">
              <EntryMark entry={p} size={22} />
              {p.name}
              {p.you && <span className="you">vous</span>}
              {editable && list.length > 1 && (
                <button type="button" className="icon-btn xs" aria-label={`Retirer ${p.name} de la liste`} onClick={() => void change(list.filter((x) => key(x) !== key(p)))}>
                  <XIcon size={13} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (restricted || draft) && (
        <Picker entries={candidates} label={`Ajouter à la liste ${KIND_LABEL[kind].toLowerCase()}`} placeholder="Ajouter une personne ou un groupe…" onPick={(entry) => void change([...list, entry as DirectoryEntry])} />
      )}
      {draft && (
        <div className="restriction-actions">
          <span className="form-hint">{kind === 'view' ? 'Les autres ne verront plus la page, ni dans le sommaire, ni dans la recherche.' : 'Les autres pourront lire et commenter, plus modifier.'}</span>
          <button type="button" className="btn-line sm" onClick={() => setDraft(null)}>
            Annuler
          </button>
          <button
            type="button"
            className="btn-ink sm"
            disabled={draft.length === 0}
            onClick={async () => {
              if (await onSave(draft)) setDraft(null);
            }}
          >
            Restreindre
          </button>
        </div>
      )}
    </div>
  );
}

function names(list: PrincipalView[]): string {
  const all = list.map((p) => p.name);
  return all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} et ${all.at(-1)}`;
}
