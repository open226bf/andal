import { XIcon } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** draw.io auto-hébergé: le service drawio du docker compose en dev, `/drawio` derrière Caddy en production. */
const DRAWIO_URL = new URL(import.meta.env.VITE_DRAWIO_URL ?? 'http://localhost:58081', window.location.origin);
const DRAWIO_ORIGIN = DRAWIO_URL.origin;
const EMBED = `${DRAWIO_URL.href.replace(/\/+$/, '')}/?embed=1&proto=json&spin=1&ui=min&lang=fr&saveAndExit=1&noExitBtn=0`;

interface Props {
  xml: string;
  onSave: (svgDataUri: string, xml: string) => void;
  onClose: () => void;
}

/**
 * Éditeur draw.io en mode embed, dialogue par postMessage. Seuls les messages
 * venant de l'iframe et de l'origine draw.io sont pris en compte.
 * Le SVG exporté reste pour l'instant dans le document; il ira dans RustFS.
 */
export function DrawioEditor({ xml, onSave, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const pendingXml = useRef<string>(xml);
  const exitAfterExport = useRef(false);

  useEffect(() => {
    const post = (message: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), DRAWIO_ORIGIN);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== DRAWIO_ORIGIN || event.source !== frame.current?.contentWindow) return;
      if (typeof event.data !== 'string') return;
      let msg: { event?: string; xml?: string; data?: string; exit?: boolean };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.event === 'init') post({ action: 'load', xml: xml || '', autosave: 0, title: 'Schéma' });
      if (msg.event === 'save' && msg.xml) {
        pendingXml.current = msg.xml;
        exitAfterExport.current = Boolean(msg.exit);
        post({ action: 'export', format: 'xmlsvg', spinKey: 'saving' });
      }
      if (msg.event === 'export' && msg.data?.startsWith('data:image/svg+xml')) {
        onSave(msg.data, pendingXml.current);
        if (exitAfterExport.current) onClose();
      }
      if (msg.event === 'exit') onClose();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [xml, onSave, onClose]);

  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawio-dialog" role="dialog" aria-label="Éditeur draw.io">
        <div className="pop-head">
          <h2>Modifier le schéma</h2>
          <button type="button" className="icon-btn sm" aria-label="Fermer" onClick={onClose}>
            <XIcon size={18} aria-hidden />
          </button>
        </div>
        <iframe ref={frame} src={EMBED} title="draw.io" />
      </div>
    </>,
    document.body,
  );
}
