import { Avatar } from '@andal/ui';
import { Fragment, useId, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { useMentionable, type Mentionable, type ThreadComment } from '../lib/api';
import { fold } from './Picker';

/** Le même motif que le serveur (packages/db/src/mentions.ts): le @ ouvre un mot. */
const MENTION = /(^|[\s([{«"'’])@([a-z0-9._-]{2,40})/gi;
/** Citation en cours de frappe, juste avant le curseur. */
const TYPING = /(^|[\s([{«"'’])@([a-z0-9._-]{0,40})$/i;
const LIMIT = 6;

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  pageId: string;
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Zone de texte d'un commentaire, avec citation: « @ » puis quelques lettres
 * propose les personnes qui peuvent lire la page. Flèches, Entrée ou Tab pour
 * choisir; Échap ferme la liste sans abandonner le commentaire.
 */
export function MentionTextarea({ pageId, value, onValueChange, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [typing, setTyping] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const people = useMentionable(pageId, typing !== null);

  const q = fold(typing?.query ?? '');
  const matches = (people.data ?? []).filter((p) => !p.you && (fold(p.username).startsWith(q) || fold(p.name).split(/\s+/).some((w) => w.startsWith(q)))).slice(0, LIMIT);
  const open = typing !== null && matches.length > 0;

  const detect = (text: string, caret: number) => {
    const found = TYPING.exec(text.slice(0, caret));
    setTyping(found ? { start: caret - found[2]!.length - 1, query: found[2]! } : null);
    setActive(0);
  };

  const insert = (person: Mentionable) => {
    const el = ref.current;
    if (!el || !typing) return;
    const end = typing.start + 1 + typing.query.length;
    const next = `${value.slice(0, typing.start)}@${person.username} ${value.slice(end)}`;
    onValueChange(next);
    setTyping(null);
    const caret = typing.start + person.username.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((i) => (event.key === 'ArrowDown' ? Math.min(i + 1, matches.length - 1) : Math.max(i - 1, 0)));
        return;
      }
      if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') {
        event.preventDefault();
        insert(matches[active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setTyping(null);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    <div className="mention-field">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setTyping(null)}
        onKeyDown={keyDown}
      />
      {open && (
        <ul className="mention-list" id={listId} role="listbox" aria-label="Personnes à citer">
          {matches.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(p);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar initials={p.initials} color={p.color} size={22} />
              <b>{p.name}</b>
              <small>@{p.username}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Le texte d'un commentaire, avec les citations reconnues mises en évidence. */
export function CommentBody({ comment }: { comment: ThreadComment }) {
  const known = new Map(comment.mentions.map((m) => [m.username.toLowerCase(), m]));
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of comment.body.matchAll(MENTION)) {
    const raw = match[2]!;
    const trimmed = raw.replace(/[._-]+$/, '');
    const person = known.get(raw.toLowerCase()) ?? known.get(trimmed.toLowerCase());
    if (!person) continue;
    const at = match.index + match[1]!.length;
    const used = known.has(raw.toLowerCase()) ? raw : trimmed;
    parts.push(comment.body.slice(last, at));
    parts.push(
      <span key={at} className="mention" data-you={person.you ? 'true' : undefined} title={`@${person.username}`}>
        @{person.name}
      </span>,
    );
    last = at + 1 + used.length;
  }
  parts.push(comment.body.slice(last));
  return (
    <p>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </p>
  );
}

/** Après l'envoi: les personnes citées qui ne lisent pas la page n'ont rien reçu. */
export function unreachableNotice(names: string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`;
  return names.length === 1
    ? `${list} ne peut pas lire cette page : cette personne n’a pas été prévenue.`
    : `${list} ne peuvent pas lire cette page : ces personnes n’ont pas été prévenues.`;
}
