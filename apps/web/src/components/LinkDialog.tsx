import { pageIdFromHref } from '@andal/editor';
import { GlobeIcon, LinkBreakIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Editor } from '@tiptap/react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { usePageLookup, type LinkedPage } from '../lib/api';

interface Option {
  key: string;
  href: string;
  /** Texte inséré quand rien n'est sélectionné. */
  label: string;
  page?: LinkedPage;
}

/** « example.com/doc » devient « https://example.com/doc »; une phrase n'est pas une adresse. */
function asUrl(text: string): string | null {
  const value = text.trim();
  if (/^(https?:\/\/|mailto:)\S+$/i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
  return null;
}

/**
 * Poser un lien sur la sélection, ou l'insérer: une page d'Andal (trouvée par
 * son titre ou son numéro, dans tous les volumes lisibles) ou une adresse web.
 */
export function LinkDialog({ editor, open, onOpenChange, volume }: { editor: Editor; open: boolean; onOpenChange: (open: boolean) => void; volume: string }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [existing, setExisting] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const href = editor.isActive('link') ? String(editor.getAttributes('link').href ?? '') : null;
    const { from, to } = editor.state.selection;
    setExisting(href);
    setQuery(href && !pageIdFromHref(href) ? href : editor.state.doc.textBetween(from, to, ' ').slice(0, 80));
    setActive(0);
  }, [open, editor]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const pages = usePageLookup(debounced, volume);
  const url = asUrl(query);
  const options: Option[] = [
    ...(url ? [{ key: 'url', href: url, label: url.replace(/^https?:\/\//, '').replace(/^mailto:/, '') }] : []),
    ...(debounced.trim() ? (pages.data ?? []) : []).map((page) => ({ key: page.id, href: `/p/${page.id}`, label: page.title, page })),
  ];

  const apply = (option: Option | undefined) => {
    if (!option) return;
    onOpenChange(false);
    const chain = editor.chain().focus();
    if (editor.isActive('link')) {
      chain.extendMarkRange('link').setLink({ href: option.href }).run();
    } else if (editor.state.selection.empty) {
      // Le texte du lien, puis une espace hors du lien: on continue d'écrire normalement.
      chain.insertContent([{ type: 'text', text: option.label, marks: [{ type: 'link', attrs: { href: option.href } }] }, { type: 'text', text: ' ' }]).run();
    } else {
      chain.setLink({ href: option.href }).run();
    }
  };

  const unlink = () => {
    onOpenChange(false);
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') setActive((i) => Math.min(i + 1, options.length - 1));
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (event.key === 'Enter') apply(options[active]);
    else return;
    event.preventDefault();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        {/* Le focus revient à l'éditeur, pas au bouton qui a ouvert la boîte. */}
        <Dialog.Content className="pop search-dialog link-dialog" aria-describedby={undefined} onCloseAutoFocus={(e) => e.preventDefault()}>
          <Dialog.Title className="sr-only">Lien</Dialog.Title>
          <input
            className="search-input"
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
            aria-label="Page ou adresse du lien"
            placeholder="Chercher une page, ou coller une adresse…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul className="search-results" role="listbox" id={listId} aria-label="Destinations" aria-busy={pages.isFetching}>
            {options.map((option, i) => (
              <li key={option.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => apply(option)}>
                {option.page ? (
                  <span className="link-option" data-vol={option.page.project.cloth}>
                    <span className="num">{option.page.number}</span>
                    <span>
                      {option.page.title} <small className="text-ink-3">· {option.page.project.shortName}</small>
                    </span>
                  </span>
                ) : (
                  <span className="link-option">
                    <GlobeIcon size={18} aria-hidden />
                    <span>
                      Lien vers <b>{option.label}</b>
                    </span>
                  </span>
                )}
              </li>
            ))}
            {options.length === 0 && (
              <li className="search-empty" role="presentation">
                {query.trim() ? (pages.isFetching ? 'Recherche…' : 'Aucune page lisible ne porte ce titre. Collez une adresse pour un lien externe.') : 'Tapez quelques lettres du titre, un numéro (3.2) ou une adresse web.'}
              </li>
            )}
          </ul>
          {existing && (
            <div className="link-foot">
              <button type="button" className="btn-line sm" onClick={unlink}>
                <LinkBreakIcon size={16} aria-hidden />
                Retirer le lien
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
