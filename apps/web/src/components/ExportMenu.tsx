import { DownloadSimpleIcon, FilePdfIcon, MarkdownLogoIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { download, errorMessage, useMe, type PageDetail } from '../lib/api';
import { t } from '../lib/i18n';

type Format = 'markdown' | 'pdf';

/** Exporter la page: Markdown tout de suite, PDF mis en page par le serveur (quelques secondes). */
export function ExportMenu({ page }: { page: PageDetail }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: Format) => {
    setPending(format);
    setError(null);
    try {
      await download(`/pages/${page.id}/export?format=${format}`, `${page.title}.${format === 'pdf' ? 'pdf' : 'md'}`);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
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
        <button type="button" className="icon-btn on-band" aria-label={t('Exporter la page')} title={t('Exporter la page')}>
          <DownloadSimpleIcon size={18} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop menu" align="end" sideOffset={8} collisionPadding={16}>
          <p className="menu-head">{t('Exporter « {title} »', { title: page.title })}</p>
          <button type="button" className="menu-item" disabled={pending !== null} onClick={() => void run('markdown')}>
            {pending === 'markdown' ? <SpinnerGapIcon size={18} className="spin" aria-hidden /> : <MarkdownLogoIcon size={18} aria-hidden />}
            <span className="menu-text">
              {t('Markdown')}
              <small>{t('Le texte et les liens, à relire partout')}</small>
            </span>
          </button>
          {me.data?.features.pdf && (
            <button type="button" className="menu-item" disabled={pending !== null} onClick={() => void run('pdf')}>
              {pending === 'pdf' ? <SpinnerGapIcon size={18} className="spin" aria-hidden /> : <FilePdfIcon size={18} aria-hidden />}
              <span className="menu-text">
                {pending === 'pdf' ? t('Mise en page du PDF…') : t('PDF')}
                <small>{t('Mis en page pour l’impression, schémas compris')}</small>
              </span>
            </button>
          )}
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
