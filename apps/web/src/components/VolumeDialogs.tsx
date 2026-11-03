import { ArchiveIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { api, errorMessage, useArchivedVolumes, useRayons, type Cloth, type ProjectSummary, type Tree } from '../lib/api';
import { relative } from '../lib/format';
import { spineHeight } from '../lib/volumes';
import { FormError } from './AuthCard';
import { Modal } from './Dialog';

/** Les six toiles de l'étagère. Leur nom de code vient des premiers volumes; on montre leur couleur. */
export const CLOTHS: { cloth: Cloth; label: string }[] = [
  { cloth: 'paiements', label: 'Sarcelle' },
  { cloth: 'identite', label: 'Indigo' },
  { cloth: 'plateforme', label: 'Bleu' },
  { cloth: 'mobile', label: 'Framboise' },
  { cloth: 'design', label: 'Brique' },
  { cloth: 'donnees', label: 'Ocre' },
];

const NAME_MAX = 80;
const SHORT_MAX = 24;
const DESCRIPTION_MAX = 280;

interface VolumeValues {
  name: string;
  shortName: string;
  description: string;
  cloth: Cloth;
  /** '' pour hors rayon. */
  rayonId: string;
}

/** La toile la moins portée sur l'étagère: un nouveau volume s'y distingue d'emblée. */
function freeCloth(projects: ProjectSummary[]): Cloth {
  const count = (c: Cloth) => projects.filter((p) => p.cloth === c).length;
  return [...CLOTHS].sort((a, b) => count(a.cloth) - count(b.cloth))[0]!.cloth;
}

/** Nom, dos, description et toile d'un volume, avec le dos tel qu'il apparaîtra dans l'étagère. */
function VolumeForm({ initial, number, submitLabel, onSubmit }: { initial: VolumeValues; number: number; submitLabel: string; onSubmit: (values: VolumeValues) => Promise<void> }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (patch: Partial<VolumeValues>) => setValues((v) => ({ ...v, ...patch }));

  const name = values.name.trim();
  const spine = values.shortName.trim() || name;
  const tooLong = spine.length > SHORT_MAX;
  const unchanged = JSON.stringify(values) === JSON.stringify(initial);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <form className="dialog-body volume-form" onSubmit={(e) => void submit(e)}>
      {error && <FormError>{error}</FormError>}
      <div className="volume-fields">
        <div className="field">
          <label htmlFor="volume-name">Nom</label>
          <input id="volume-name" className="input" required autoFocus maxLength={NAME_MAX} value={values.name} onChange={(e) => set({ name: e.target.value })} placeholder="Plateforme Paiements" />
        </div>
        <div className="field">
          <label htmlFor="volume-short">Nom court</label>
          <input
            id="volume-short"
            className="input"
            maxLength={SHORT_MAX + 10}
            value={values.shortName}
            onChange={(e) => set({ shortName: e.target.value })}
            placeholder={name.slice(0, SHORT_MAX) || 'Paiements'}
            aria-describedby="volume-short-hint"
            aria-invalid={tooLong || undefined}
          />
          <p id="volume-short-hint" className={`form-hint${tooLong ? ' bad' : ''}`}>
            {tooLong ? `Trop long pour le dos du volume: ${spine.length} caractères sur ${SHORT_MAX}.` : 'Écrit sur le dos du volume, dans l’étagère. Le nom par défaut.'}
          </p>
        </div>
        <div className="field">
          <label htmlFor="volume-description">
            Description <span className="optional">facultative</span>
          </label>
          <textarea id="volume-description" className="input" rows={2} maxLength={DESCRIPTION_MAX} value={values.description} onChange={(e) => set({ description: e.target.value })} placeholder="Ce que l’on trouve dans ce volume, et pour qui." />
        </div>
        <RayonField value={values.rayonId} onChange={(rayonId) => set({ rayonId })} />
        <fieldset className="field swatches">
          <legend>Toile</legend>
          <div className="swatch-row">
            {CLOTHS.map(({ cloth, label }) => (
              <label key={cloth} className="swatch" data-vol={cloth} title={label}>
                <input type="radio" name="volume-cloth" value={cloth} checked={values.cloth === cloth} onChange={() => set({ cloth })} />
                <span className="sr-only">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="volume-preview" aria-hidden>
        <span className="spine" data-vol={values.cloth} style={{ '--h': spineHeight(spine.slice(0, SHORT_MAX)) } as CSSProperties}>
          <b className="spine-num">{number}</b>
          <span className="spine-label">{spine.slice(0, SHORT_MAX) || '…'}</span>
        </span>
      </div>
      <button type="submit" className="btn-ink" disabled={pending || !name || tooLong || unchanged}>
        {pending ? 'Un instant…' : submitLabel}
      </button>
    </form>
  );
}

/** Le rayon de la bibliothèque où ranger le volume; absent tant que l'espace n'a pas de rayon. */
function RayonField({ value, onChange }: { value: string; onChange: (rayonId: string) => void }) {
  const rayons = useRayons();
  if (!rayons.data?.length) return null;
  return (
    <div className="field">
      <label htmlFor="volume-rayon">
        Rayon <span className="optional">dans la bibliothèque</span>
      </label>
      <select id="volume-rayon" className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Hors rayon</option>
        {rayons.data.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Nouveau volume: on en devient l'admin, il s'ouvre sur sa première page, prête à écrire. */
export function NewVolumeDialog({ open, onOpenChange, projects }: { open: boolean; onOpenChange: (open: boolean) => void; projects: ProjectSummary[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const next = Math.max(0, ...projects.map((p) => p.volumeNumber)) + 1;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Nouveau volume">
      {open && (
        <VolumeForm
          initial={{ name: '', shortName: '', description: '', cloth: freeCloth(projects), rayonId: '' }}
          number={next}
          submitLabel="Créer le volume"
          onSubmit={async (values) => {
            const created = await api<{ slug: string; firstPageId: string }>('/projects', { method: 'POST', body: JSON.stringify(values) });
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
            onOpenChange(false);
            await navigate({ to: '/v/$slug/$pageId', params: { slug: created.slug, pageId: created.firstPageId }, search: { edition: true } });
          }}
        />
      )}
    </Modal>
  );
}

/** Supprimer un volume archivé: il faut retaper son nom court. */
function DeleteVolume({ volume, onDeleted }: { volume: { id: string; shortName: string }; onDeleted: () => Promise<void> }) {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api(`/projects/${volume.id}`, { method: 'DELETE', body: JSON.stringify({ confirm }) });
      await onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };
  return (
    <form className="danger-zone" onSubmit={(e) => void submit(e)}>
      <p className="dialog-text">Pages, sous-pages, commentaires, historique et droits disparaissent avec le volume. C’est sans retour.</p>
      {error && <FormError>{error}</FormError>}
      <div className="field">
        <label htmlFor={`delete-${volume.id}`}>
          Tapez <b>{volume.shortName}</b> pour confirmer
        </label>
        <input id={`delete-${volume.id}`} className="input" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <button type="submit" className="btn-danger" disabled={pending || confirm.trim() !== volume.shortName}>
        {pending ? 'Suppression…' : 'Supprimer définitivement'}
      </button>
    </form>
  );
}

/** Réglages d'un volume, pour ses admins: le modifier, l'archiver; archivé, le désarchiver ou le supprimer. */
export function VolumeSettingsDialog({ tree, open, onOpenChange }: { tree: Tree; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const project = tree.project;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const refresh = () => Promise.all(['projects', 'tree', 'page', 'sharing', 'trash'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setConfirming(false);
      setError(null);
    }
  };

  const toggleArchive = async () => {
    setPending(true);
    setError(null);
    try {
      await api(`/projects/${project.id}/${project.archived ? 'unarchive' : 'archive'}`, { method: 'POST' });
      await refresh();
      close(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={close} title={`Réglages de « ${project.name} »`}>
      {open && !project.archived && (
        <VolumeForm
          initial={{ name: project.name, shortName: project.shortName === project.name ? '' : project.shortName, description: project.description ?? '', cloth: project.cloth, rayonId: project.rayonId ?? '' }}
          number={project.volumeNumber}
          submitLabel="Enregistrer"
          onSubmit={async (values) => {
            await api(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify(values) });
            await refresh();
            close(false);
          }}
        />
      )}
      <div className="dialog-body volume-archive">
        {error && <FormError>{error}</FormError>}
        {project.archived ? (
          <>
            <p className="dialog-text">Ce volume est archivé: hors de l’étagère et de la recherche, ses pages se lisent mais ne se modifient plus. Le désarchiver le remet en service tel quel.</p>
            <button type="button" className="btn-ink" disabled={pending} onClick={() => void toggleArchive()}>
              <ArrowCounterClockwiseIcon size={18} aria-hidden />
              Désarchiver le volume
            </button>
            {project.canDelete && (
              <DeleteVolume
                volume={project}
                onDeleted={async () => {
                  close(false);
                  await queryClient.invalidateQueries({ queryKey: ['projects'] });
                  await navigate({ to: '/' });
                }}
              />
            )}
          </>
        ) : confirming ? (
          <div className="inline-confirm">
            <p className="dialog-text">
              <b>Archiver « {project.shortName} » ?</b> Il quitte l’étagère et la recherche, et ses pages passent en lecture seule pour tout le monde, pages ouvertes comprises. Vous pourrez le désarchiver.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn-line" onClick={() => setConfirming(false)}>
                Annuler
              </button>
              <button type="button" className="btn-danger" disabled={pending} onClick={() => void toggleArchive()}>
                {pending ? 'Archivage…' : 'Archiver'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="ghost danger archive-btn" onClick={() => setConfirming(true)}>
            <ArchiveIcon size={16} aria-hidden />
            Archiver le volume…
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Les volumes archivés que vous administrez: les rouvrir, les désarchiver, les supprimer. */
export function ArchivesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const archives = useArchivedVolumes(open);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const unarchive = async (id: string) => {
    setPending(id);
    setError(null);
    try {
      await api(`/projects/${id}/unarchive`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Volumes archivés">
      <div className="dialog-body">
        {error && <FormError>{error}</FormError>}
        {archives.isPending ? (
          <div className="doc-skeleton" aria-busy="true" aria-label="Chargement des archives">
            <span />
            <span />
          </div>
        ) : archives.isError ? (
          <FormError>{errorMessage(archives.error, 'Impossible de charger les archives.')}</FormError>
        ) : archives.data.length === 0 ? (
          <p className="dialog-text">Aucun volume archivé parmi ceux que vous administrez.</p>
        ) : (
          <ul className="archive-list">
            {archives.data.map((v) => (
              <li key={v.id}>
                <div className="archive-row">
                  <span className="vol-swatch" data-vol={v.cloth} aria-hidden />
                  <span className="archive-text">
                    <b>
                      Vol. {v.volumeNumber} · {v.name}
                    </b>
                    <small>
                      {v.pageCount} page{v.pageCount > 1 ? 's' : ''} · archivé {v.archivedBy ? `par ${v.archivedBy}, ` : ''}
                      {relative(v.archivedAt)}
                    </small>
                  </span>
                  <span className="trash-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        onOpenChange(false);
                        void navigate({ to: '/v/$slug', params: { slug: v.slug } });
                      }}
                    >
                      Ouvrir
                    </button>
                    {v.canDelete && (
                      <button type="button" className="ghost danger" aria-expanded={deleting === v.id} onClick={() => setDeleting(deleting === v.id ? null : v.id)}>
                        Supprimer…
                      </button>
                    )}
                    <button type="button" className="btn-line sm" disabled={pending !== null} onClick={() => void unarchive(v.id)}>
                      {pending === v.id ? 'Un instant…' : 'Désarchiver'}
                    </button>
                  </span>
                </div>
                {deleting === v.id && (
                  <DeleteVolume
                    volume={v}
                    onDeleted={async () => {
                      setDeleting(null);
                      await queryClient.invalidateQueries({ queryKey: ['projects'] });
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
