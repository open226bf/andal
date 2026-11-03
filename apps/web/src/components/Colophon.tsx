import { AccessMark, type AccessLevel } from '@andal/ui';
import { ArrowBendDownRightIcon, ClockCounterClockwiseIcon, LockSimpleIcon } from '@phosphor-icons/react';
import type { PageDetail, PrincipalView } from '../lib/api';
import { date } from '../lib/format';

const LEVELS: { level: AccessLevel; label: string }[] = [
  { level: 'write', label: 'Écriture' },
  { level: 'comment', label: 'Commentaire' },
  { level: 'read', label: 'Lecture' },
];

/** Le colophon: qui peut écrire, commenter, lire, et l'historique de la page. */
export function Colophon({ page, onHistory }: { page: PageDetail; onHistory: () => void }) {
  const restriction = page.access.restrictions[0];
  // Toute la liste de cette restriction, pas seulement son premier nom.
  const listed = restriction ? page.access.restrictions.filter((r) => r.pageId === restriction.pageId && r.kind === restriction.kind).map((r) => r.principal.name) : [];
  const names = listed.length > 1 ? `${listed.slice(0, -1).join(', ')} et ${listed.at(-1)}` : (listed[0] ?? '');
  return (
    <section className="colophon" aria-label="Accès et historique de la page">
      <dl className="access">
        {LEVELS.map(({ level, label }) => (
          <div key={level}>
            <dt>
              <AccessMark level={level} />
              {label}
            </dt>
            <dd>
              {page.access[level].length === 0 ? <span className="none">Personne</span> : page.access[level].map((p, i) => <Principal key={p.id} principal={p} last={i === page.access[level].length - 1} />)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="colophon-meta">
        <span>
          {restriction ? <LockSimpleIcon size={15} aria-hidden /> : <ArrowBendDownRightIcon size={15} aria-hidden />}
          {restriction
            ? `Restreinte en ${restriction.kind === 'view' ? 'lecture' : 'écriture'} à ${names}`
            : 'Droits hérités du volume, sans restriction'}
        </span>
        <button type="button" className="colophon-history" onClick={onHistory} title="Voir l’historique de la page">
          <ClockCounterClockwiseIcon size={15} aria-hidden />
          v{page.version}, modifiée le {date(page.updatedAt)}
          {page.updatedBy ? ` par ${page.updatedBy}` : ''}
          <span className="colophon-link">Historique</span>
        </button>
      </p>
    </section>
  );
}

function Principal({ principal, last }: { principal: PrincipalView; last: boolean }) {
  return (
    <span>
      {principal.name}
      {principal.members !== null && <span className="count">{principal.members}</span>}
      {principal.you && <span className="you">vous</span>}
      {!last && ', '}
    </span>
  );
}
