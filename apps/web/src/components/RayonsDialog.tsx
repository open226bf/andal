import { ArrowDownIcon, ArrowUpIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage, useRayons, type ProjectSummary, type Rayon } from '../lib/api';
import { t, tn } from '../lib/i18n';
import { FormError } from './AuthCard';
import { Modal } from './Dialog';

/**
 * Ranger la bibliothèque (admins de l'espace): créer, renommer, ordonner et
 * supprimer les rayons. Supprimer un rayon laisse ses volumes hors rayon.
 */
export function RayonsDialog({ open, onOpenChange, volumes }: { open: boolean; onOpenChange: (open: boolean) => void; volumes: ProjectSummary[] }) {
  const rayons = useRayons();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [name, setName] = useState('');

  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      await Promise.all(['rayons', 'projects'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setPending(false);
    }
  };

  const list = rayons.data ?? [];
  const count = (rayon: Rayon) => volumes.filter((v) => v.rayonId === rayon.id).length;

  const move = (index: number, offset: -1 | 1) => {
    const ids = list.map((r) => r.id);
    [ids[index], ids[index + offset]] = [ids[index + offset]!, ids[index]!];
    void run(() => api('/rayons/order', { method: 'PUT', body: JSON.stringify({ ids }) }));
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => api('/rayons', { method: 'POST', body: JSON.stringify({ name }) }))) setName('');
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setError(null);
          setEditing(null);
          setRemoving(null);
        }
      }}
      title={t('Ranger les rayons')}
    >
      <div className="dialog-body">
        <p className="dialog-text">{t('Les rayons rangent les volumes de la bibliothèque par domaine, dans cet ordre. Chaque admin de volume choisit le rayon du sien, dans ses réglages.')}</p>
        {error && <FormError>{error}</FormError>}
        {list.length > 0 && (
          <ol className="rayon-list">
            {list.map((rayon, index) =>
              editing === rayon.id ? (
                <li key={rayon.id}>
                  <RenameForm
                    rayon={rayon}
                    pending={pending}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (next) => {
                      if (await run(() => api(`/rayons/${rayon.id}`, { method: 'PATCH', body: JSON.stringify({ name: next }) }))) setEditing(null);
                    }}
                  />
                </li>
              ) : removing === rayon.id ? (
                <li key={rayon.id} className="trash-confirm">
                  <span className="rayon-name">
                    <b>{t('Supprimer le rayon « {name} » ?', { name: rayon.name })}</b>
                    <small>{count(rayon) > 0 ? tn(count(rayon), 'Son volume passe hors rayon; rien d’autre ne change.', 'Ses {n} volumes passent hors rayon; rien d’autre ne change.') : t('Il est vide.')}</small>
                  </span>
                  <span className="trash-actions">
                    <button type="button" className="btn-line sm" onClick={() => setRemoving(null)}>
                      {t('Annuler')}
                    </button>
                    <button
                      type="button"
                      className="btn-danger sm"
                      disabled={pending}
                      onClick={async () => {
                        if (await run(() => api(`/rayons/${rayon.id}`, { method: 'DELETE' }))) setRemoving(null);
                      }}
                    >
                      {t('Supprimer')}
                    </button>
                  </span>
                </li>
              ) : (
                <li key={rayon.id}>
                  <span className="rayon-name">
                    <b>{rayon.name}</b>
                    <small>{tn(count(rayon), '{n} volume', '{n} volumes')}</small>
                  </span>
                  <span className="trash-actions">
                    <button type="button" className="icon-btn xs" aria-label={t('Monter {name}', { name: rayon.name })} title={t('Monter')} disabled={pending || index === 0} onClick={() => move(index, -1)}>
                      <ArrowUpIcon size={16} aria-hidden />
                    </button>
                    <button type="button" className="icon-btn xs" aria-label={t('Descendre {name}', { name: rayon.name })} title={t('Descendre')} disabled={pending || index === list.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDownIcon size={16} aria-hidden />
                    </button>
                    <button type="button" className="icon-btn xs" aria-label={t('Renommer {name}', { name: rayon.name })} title={t('Renommer')} onClick={() => setEditing(rayon.id)}>
                      <PencilSimpleIcon size={16} aria-hidden />
                    </button>
                    <button type="button" className="icon-btn xs danger" aria-label={t('Supprimer {name}', { name: rayon.name })} title={t('Supprimer')} onClick={() => setRemoving(rayon.id)}>
                      <TrashIcon size={16} aria-hidden />
                    </button>
                  </span>
                </li>
              ),
            )}
          </ol>
        )}
        <form className="rayon-add" onSubmit={(e) => void add(e)}>
          <label className="sr-only" htmlFor="rayon-new">
            {t('Nouveau rayon')}
          </label>
          <input id="rayon-new" className="input" maxLength={40} placeholder={list.length ? t('Nouveau rayon') : t('Premier rayon, par exemple « Produits »')} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn-ink" disabled={pending || !name.trim()}>
            {t('Ajouter')}
          </button>
        </form>
      </div>
    </Modal>
  );
}

function RenameForm({ rayon, pending, onCancel, onSubmit }: { rayon: Rayon; pending: boolean; onCancel: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [value, setValue] = useState(rayon.name);
  return (
    <form
      className="rayon-add"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(value);
      }}
    >
      <label className="sr-only" htmlFor={`rayon-${rayon.id}`}>
        {t('Nouveau nom de {name}', { name: rayon.name })}
      </label>
      <input
        id={`rayon-${rayon.id}`}
        className="input"
        maxLength={40}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <button type="button" className="btn-line sm" onClick={onCancel}>
        {t('Annuler')}
      </button>
      <button type="submit" className="btn-ink sm" disabled={pending || !value.trim() || value.trim() === rayon.name}>
        {t('Renommer')}
      </button>
    </form>
  );
}
