import { XIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../lib/api';
import { FormError } from './AuthCard';

/** Boîtes de dialogue de l'application: un titre, une croix, et le contenu. */
export function Modal({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="pop dialog" aria-describedby={undefined}>
          <div className="pop-head">
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            <Dialog.Close className="icon-btn sm" aria-label="Fermer">
              <XIcon size={18} aria-hidden />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface Confirmation {
  title: string;
  body: string;
  action: string;
  run: () => Promise<void>;
}

/** Confirmer une action qui retire quelque chose (désactiver, supprimer…). */
export function ConfirmDialog({ confirmation, onClose }: { confirmation: Confirmation | null; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (open) return;
        setError(null);
        onClose();
      }}
      title={confirmation?.title ?? ''}
    >
      <div className="dialog-body">
        {error && <FormError>{error}</FormError>}
        <p className="dialog-text">{confirmation?.body}</p>
        <div className="dialog-actions">
          <Dialog.Close className="btn-line">Annuler</Dialog.Close>
          <button
            type="button"
            className="btn-danger"
            disabled={pending}
            onClick={async () => {
              if (!confirmation) return;
              setPending(true);
              setError(null);
              try {
                await confirmation.run();
                onClose();
              } catch (err) {
                // Refusé (droits, règle): on le dit ici, la boîte reste ouverte.
                setError(errorMessage(err));
              } finally {
                setPending(false);
              }
            }}
          >
            {confirmation?.action}
          </button>
        </div>
      </div>
    </Modal>
  );
}
