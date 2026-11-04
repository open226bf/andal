import { DotsThreeIcon, FileArchiveIcon, SpinnerGapIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { download, errorMessage, type Tree } from '../lib/api';
import { t } from '../lib/i18n';

/** Le menu « ⋯ » du volume, en tête du sommaire: importer des pages, exporter le volume. */
export function VolumeMenu({ tree, onImport }: { tree: Tree; onImport: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportVolume = async () => {
    setPending(true);
    setError(null);
    try {
      await download(`/projects/${tree.project.id}/export`, `${tree.project.slug}.zip`);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className="icon-btn sm" aria-label={t('Plus d’actions sur {name}', { name: tree.project.name })} title={t('Importer, exporter')}>
          <DotsThreeIcon size={18} weight="bold" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop menu" side="bottom" align="end" sideOffset={6} collisionPadding={16}>
          {onImport && (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onImport();
              }}
            >
              <UploadSimpleIcon size={18} aria-hidden />
              <span className="menu-text">
                {t('Importer des pages…')}
                <small>{t('Markdown, Notion ou Confluence')}</small>
              </span>
            </button>
          )}
          <button type="button" className="menu-item" disabled={pending} onClick={() => void exportVolume()}>
            {pending ? <SpinnerGapIcon size={18} className="spin" aria-hidden /> : <FileArchiveIcon size={18} aria-hidden />}
            <span className="menu-text">
              {t('Exporter le volume')}
              <small>{t('Archive Markdown, fichiers compris')}</small>
            </span>
          </button>
          {error && (
            <p className="menu-error" role="alert">
              {error}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
