import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { fold } from '../components/Picker';
import { api, type ProjectSummary, type Rayon } from './api';

export type VolumeSort = 'number' | 'name' | 'activity';

/** « paie », « 3 » ou « jetons » retrouvent un volume par son nom, son nom court, sa description ou son numéro. */
export function matchesVolume(volume: ProjectSummary, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return [volume.name, volume.shortName, volume.description ?? '', String(volume.volumeNumber)].some((text) => fold(text).includes(q));
}

export function sortVolumes(volumes: ProjectSummary[], sort: VolumeSort): ProjectSummary[] {
  const sorted = [...volumes];
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  else if (sort === 'activity') sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  else sorted.sort((a, b) => a.volumeNumber - b.volumeNumber);
  return sorted;
}

export interface RayonShelf {
  /** null: les volumes hors rayon. */
  rayon: Rayon | null;
  volumes: ProjectSummary[];
}

/**
 * Les volumes rangés par rayon, dans l'ordre des rayons, puis ceux hors rayon.
 * Un rayon vide n'apparaît que si `keepEmpty` (pour qui range la bibliothèque).
 */
export function byRayon(volumes: ProjectSummary[], rayons: Rayon[], keepEmpty = false): RayonShelf[] {
  const known = new Set(rayons.map((r) => r.id));
  const shelves: RayonShelf[] = rayons.map((rayon) => ({ rayon, volumes: volumes.filter((v) => v.rayonId === rayon.id) }));
  shelves.push({ rayon: null, volumes: volumes.filter((v) => v.rayonId === null || !known.has(v.rayonId)) });
  return shelves.filter((s) => s.volumes.length > 0 || (keepEmpty && s.rayon !== null));
}

/**
 * Hauteur d'un dos: juste de quoi écrire son nom court entre le numéro et la
 * nervure du bas, pour que l'étagère en range le plus possible.
 */
export function spineHeight(shortName: string): string {
  return `${Math.round(Math.min(150, Math.max(92, 52 + shortName.length * 7.2)))}px`;
}

/** L'adresse d'un volume: sa première page, ou le volume lui-même s'il n'en a pas encore. */
export function volumeLink(volume: ProjectSummary) {
  return volume.firstPageId
    ? ({ to: '/v/$slug/$pageId', params: { slug: volume.slug, pageId: volume.firstPageId } } as const)
    : ({ to: '/v/$slug', params: { slug: volume.slug } } as const);
}

/** Poser un volume sur l'étagère ou l'en retirer: l'étagère bouge tout de suite, l'API suit. */
export function useTogglePin() {
  const queryClient = useQueryClient();
  return useCallback(
    async (volume: ProjectSummary) => {
      const pinned = !volume.pinned;
      queryClient.setQueryData<ProjectSummary[]>(['projects'], (list) => list?.map((p) => (p.id === volume.id ? { ...p, pinned } : p)));
      try {
        await api(`/projects/${volume.id}/pin`, { method: pinned ? 'PUT' : 'DELETE' });
      } finally {
        await queryClient.invalidateQueries({ queryKey: ['projects'], exact: true });
      }
    },
    [queryClient],
  );
}
