import { Avatar } from '@andal/ui';
import { UsersThreeIcon } from '@phosphor-icons/react';
import { useId, useState, type KeyboardEvent } from 'react';
import { t, tn } from '../lib/i18n';

export interface PickerEntry {
  type: 'user' | 'group';
  id: string;
  name: string;
  /** Identifiant, email, ou « 3 personne(s) ». */
  detail: string;
  /** Pour un groupe: le nombre de membres, affiché dans la langue de l'interface. */
  members?: number | null;
  initials: string | null;
  color: string | null;
}

const LIMIT = 6;

/** Sans accents ni casse: « lea » trouve « Léa ». */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Choisir une personne ou un groupe en tapant: liste filtrée sous le champ,
 * flèches pour parcourir, Entrée pour choisir. La liste reste dans le flux
 * pour ne pas être coupée par un panneau qui défile.
 */
export function Picker({ entries, onPick, placeholder, label, autoFocus }: { entries: PickerEntry[]; onPick: (entry: PickerEntry) => void; placeholder: string; label: string; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();

  const q = fold(query.trim());
  const matches = entries.filter((e) => !q || fold(e.name).includes(q) || fold(e.detail).includes(q)).slice(0, LIMIT);
  const shown = open && query.trim().length > 0;

  const pick = (entry: PickerEntry | undefined) => {
    if (!entry) return;
    onPick(entry);
    setQuery('');
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!shown) return;
    if (event.key === 'ArrowDown') setActive((i) => Math.min(i + 1, matches.length - 1));
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (event.key === 'Enter') pick(matches[active]);
    else if (event.key === 'Escape') {
      // Fermer la liste, pas le panneau qui la contient.
      event.stopPropagation();
      setQuery('');
    } else return;
    event.preventDefault();
  };

  return (
    <div className="picker">
      <input
        className="input"
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && matches[active] ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <ul className="picker-list" id={listId} role="listbox" aria-label={label}>
          {matches.length === 0 && <li className="picker-empty">{t('Personne ne correspond.')}</li>}
          {matches.map((entry, i) => (
            <li
              key={`${entry.type}:${entry.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown: choisir avant que le champ perde le focus.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(entry);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <EntryMark entry={entry} />
              <span>
                <b>{entry.name}</b>
                <small>{entry.type === 'group' && typeof entry.members === 'number' ? tn(entry.members, '{n} personne', '{n} personnes') : entry.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Avatar d'une personne, pictogramme d'un groupe. */
export function EntryMark({ entry, size = 28 }: { entry: { type: 'user' | 'group'; initials: string | null; color: string | null }; size?: number }) {
  if (entry.type === 'user' && entry.initials && entry.color) return <Avatar initials={entry.initials} color={entry.color} size={size} />;
  return (
    <span className="grp" style={{ width: size, height: size }} aria-hidden>
      <UsersThreeIcon size={Math.round(size * 0.55)} />
    </span>
  );
}
