import { ArchiveIcon, BooksIcon, CaretUpDownIcon, PushPinIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { Link, useNavigate } from '@tanstack/react-router';
import { Fragment, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useProjects, useRayons, type ProjectSummary, type Tree } from '../lib/api';
import { byRayon, matchesVolume, sortVolumes, volumeLink } from '../lib/volumes';

/**
 * L'en-tête du sommaire ouvre le sélecteur de volume: taper quelques lettres,
 * flèches, Entrée. Sans recherche, l'étagère vient d'abord, puis le reste de
 * la bibliothèque, rayon par rayon.
 */
export function VolumeSwitcher({ tree }: { tree: Tree }) {
  const projects = useProjects();
  const rayons = useRayons();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const all = projects.data ?? [];
  const matches = sortVolumes(
    all.filter((v) => matchesVolume(v, query)),
    'number',
  );
  const searching = query.trim().length > 0;
  const groups: { label: string | null; volumes: ProjectSummary[] }[] = searching
    ? [{ label: null, volumes: matches }]
    : [
        { label: 'Sur votre étagère', volumes: matches.filter((v) => v.pinned) },
        ...byRayon(
          matches.filter((v) => !v.pinned),
          rayons.data ?? [],
        ).map((shelf) => ({ label: shelf.rayon?.name ?? (rayons.data?.length ? 'Hors rayon' : 'Dans la bibliothèque'), volumes: shelf.volumes })),
      ].filter((g) => g.volumes.length > 0);
  const ordered = groups.flatMap((g) => g.volumes);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listId]);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  const go = (volume: ProjectSummary | undefined) => {
    if (!volume) return;
    close(false);
    void navigate(volumeLink(volume));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') setActive((i) => Math.min(i + 1, ordered.length - 1));
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(ordered.length - 1);
    else if (event.key === 'Enter') go(ordered[active]);
    else return;
    event.preventDefault();
  };

  let index = -1;
  return (
    <Popover.Root open={open} onOpenChange={close}>
      <Popover.Trigger asChild>
        <button type="button" className="toc-vol-text toc-switch" aria-label={`${tree.project.name}: changer de volume`}>
          <span className="toc-vol-name">
            {tree.project.name}
            <CaretUpDownIcon size={14} aria-hidden />
          </span>
          <span className="vol-count">
            Vol. {tree.project.volumeNumber} · {tree.pages.length} page{tree.pages.length > 1 ? 's' : ''}
            {tree.project.archived && (
              <span className="archived-tag">
                <ArchiveIcon size={12} aria-hidden />
                archivé
              </span>
            )}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop switcher" side="bottom" align="start" sideOffset={6} collisionPadding={16}>
          <input
            className="switcher-input"
            role="combobox"
            aria-label="Aller au volume"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={ordered.length > 0 ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Aller au volume…"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <ul className="switcher-list" role="listbox" id={listId} aria-label="Volumes">
            {groups.map((group) => (
              <Fragment key={group.label ?? 'found'}>
                {group.label && (
                  <li className="switcher-group" role="presentation">
                    {group.label}
                  </li>
                )}
                {group.volumes.map((v) => {
                  index += 1;
                  const i = index;
                  return (
                    <li
                      key={v.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      aria-current={v.slug === tree.project.slug ? 'true' : undefined}
                      className="switcher-item"
                      data-vol={v.cloth}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(v)}
                    >
                      <span className="vol-swatch" aria-hidden />
                      <span className="num">{v.volumeNumber}</span>
                      <span className="switcher-name">{v.name}</span>
                      {searching && v.pinned && <PushPinIcon size={14} weight="fill" aria-label="sur votre étagère" />}
                    </li>
                  );
                })}
              </Fragment>
            ))}
            {ordered.length === 0 && (
              <li className="search-empty" role="presentation">
                {projects.isPending ? 'Chargement…' : `Aucun volume ne correspond à « ${query.trim()} ».`}
              </li>
            )}
          </ul>
          <Link to="/" className="switcher-foot" onClick={() => close(false)}>
            <BooksIcon size={16} aria-hidden />
            Toute la bibliothèque
            <span className="count">{all.length}</span>
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
