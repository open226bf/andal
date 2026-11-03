import type { ApiOperation } from '@andal/editor';
import {
  ArrowsLeftRightIcon,
  BookOpenTextIcon,
  CodeIcon,
  CopyIcon,
  LightbulbIcon,
  PencilSimpleIcon,
  FlowArrowIcon,
} from '@phosphor-icons/react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState, type CSSProperties, type DependencyList } from 'react';
import { useDoc, useNumber } from '../lib/doc-context';
import { renderMermaid } from '../lib/mermaid';
import { usePaletteVersion } from '../lib/theme';
import { DrawioEditor } from './DrawioEditor';

/** Fondu sur le bord et « Faire défiler » quand un schéma dépasse son cadre (mobile). */
function useScrollCue(deps: DependencyList) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const sync = () => {
      const max = frame.scrollWidth - frame.clientWidth;
      frame.classList.toggle('scroll-l', max > 2 && frame.scrollLeft > 2);
      frame.classList.toggle('scroll-r', max > 2 && frame.scrollLeft < max - 2);
      frame.closest('.fig')?.classList.toggle('scrollable', max > 2);
    };
    sync();
    frame.addEventListener('scroll', sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(frame);
    return () => {
      frame.removeEventListener('scroll', sync);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

const scrollHint = (
  <span className="scroll-hint">
    <ArrowsLeftRightIcon size={16} aria-hidden />
    Faire défiler
  </span>
);

function Caption({ label, caption, editable, onChange, children }: { label: string; caption: string; editable: boolean; onChange: (value: string) => void; children?: React.ReactNode }) {
  return (
    <figcaption contentEditable={false}>
      <span className="fignum">{label}</span>
      {editable ? (
        <input className="cap-input" value={caption} placeholder="Légende" aria-label="Légende" onChange={(e) => onChange(e.target.value)} />
      ) : (
        <span className="cap-text">{caption}</span>
      )}
      <span className="cap-actions">{children}</span>
    </figcaption>
  );
}

export function MermaidView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const { editing } = useDoc();
  const number = useNumber(editor, getPos, 'figure');
  const palette = usePaletteVersion();
  const source = String(node.attrs.source ?? '');
  const caption = String(node.attrs.caption ?? '');
  const [result, setResult] = useState<{ svg: string; width: number } | { error: string } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const frame = useScrollCue([result]);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      renderMermaid(source)
        .then((r) => alive && setResult(r))
        .catch((e: unknown) => alive && setResult({ error: e instanceof Error ? e.message : String(e) }));
    }, editing ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [source, palette, editing]);

  return (
    <NodeViewWrapper as="figure" className="fig" data-block="Mermaid">
      <div className="frame" ref={frame} contentEditable={false}>
        {result && 'svg' in result ? (
          <div
            className="mermaid-out"
            role="img"
            aria-label={caption || 'Diagramme Mermaid'}
            style={{ '--nat': `${result.width}px` } as CSSProperties}
            dangerouslySetInnerHTML={{ __html: result.svg }}
          />
        ) : result ? (
          <p className="fig-error">Le diagramme ne se lit pas: {result.error}</p>
        ) : (
          <div className="mermaid-out" aria-busy="true" />
        )}
      </div>
      <Caption label={`Figure ${number}`} caption={caption} editable={editing} onChange={(v) => updateAttributes({ caption: v })}>
        {scrollHint}
        <button type="button" className="ghost" aria-expanded={showSource} onClick={() => setShowSource((s) => !s)}>
          <CodeIcon size={16} aria-hidden />
          Source
        </button>
      </Caption>
      {showSource &&
        (editing ? (
          <textarea className="src-edit" value={source} spellCheck={false} aria-label="Source Mermaid" onChange={(e) => updateAttributes({ source: e.target.value })} />
        ) : (
          <pre className="src">{source}</pre>
        ))}
    </NodeViewWrapper>
  );
}

export function OpenApiView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const { editing } = useDoc();
  const number = useNumber(editor, getPos, 'listing');
  const op = node.attrs.operation as ApiOperation | null;
  const caption = String(node.attrs.caption ?? '');

  return (
    <NodeViewWrapper as="figure" className="fig" data-block="OpenAPI">
      <div className="api" contentEditable={false}>
        {op ? (
          <>
            <div className="api-head">
              <span className="verb">{op.method}</span>
              <code className="route">{op.path}</code>
              <span className="api-sum">{op.summary}</span>
              <button type="button" className="ghost" disabled title="Arrive avec le stockage des specs (RustFS)">
                <BookOpenTextIcon size={16} aria-hidden />
                Ouvrir dans Redoc
              </button>
            </div>
            <div className="api-cols">
              <section>
                <h3>
                  Corps de la requête {op.contentType && <span className="mime">{op.contentType}</span>}
                </h3>
                <table className="params">
                  <thead>
                    <tr>
                      <th scope="col">Champ</th>
                      <th scope="col">Type</th>
                      <th scope="col">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(op.requestBody ?? []).map((f) => (
                      <tr key={f.name}>
                        <td>
                          <code>{f.name}</code>
                          {f.required && <span className="req">requis</span>}
                        </td>
                        <td className="type">{f.type}</td>
                        <td>{f.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section>
                <h3>Réponses</h3>
                <ul className="resp">
                  {op.responses.map((r) => (
                    <li key={r.status} className={r.status < 400 ? 'ok' : 'err'}>
                      <div className="row">
                        <span className="code-n">{r.status}</span>
                        {r.description}
                      </div>
                      {r.example && <pre className="schema">{r.example}</pre>}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        ) : (
          <p className="fig-error">Opération introuvable dans {String(node.attrs.specFile)}.</p>
        )}
      </div>
      <Caption label={`Listing ${number}`} caption={caption} editable={editing} onChange={(v) => updateAttributes({ caption: v })} />
    </NodeViewWrapper>
  );
}

export function DrawioView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const { editing } = useDoc();
  const number = useNumber(editor, getPos, 'figure');
  const src = String(node.attrs.src ?? '');
  const caption = String(node.attrs.caption ?? '');
  const [open, setOpen] = useState(false);
  const frame = useScrollCue([src]);

  return (
    <NodeViewWrapper as="figure" className="fig" data-block="draw.io">
      <div className="frame" ref={frame} contentEditable={false}>
        {src ? (
          // <img> et non SVG inline: un SVG importé ne peut exécuter aucun script.
          <img className="drawio-img" src={src} alt={String(node.attrs.alt ?? caption)} />
        ) : (
          <div className="drawio-empty">
            <FlowArrowIcon size={28} aria-hidden />
            Schéma vide
          </div>
        )}
      </div>
      <Caption label={`Figure ${number}`} caption={caption} editable={editing} onChange={(v) => updateAttributes({ caption: v })}>
        {scrollHint}
        {editing && (
          <button type="button" className="ghost" onClick={() => setOpen(true)}>
            <PencilSimpleIcon size={16} aria-hidden />
            Modifier dans draw.io
          </button>
        )}
      </Caption>
      {open && (
        <DrawioEditor
          xml={(node.attrs.xml as string | null) ?? ''}
          onSave={(svg, xml) => updateAttributes({ src: svg, xml })}
          onClose={() => setOpen(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

export function CalloutView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="note-box" data-block="Encadré">
      <LightbulbIcon size={22} aria-hidden />
      <div>
        <span className="note-title" contentEditable={false}>
          {String(node.attrs.title)}
        </span>
        <NodeViewContent className="note-content" />
      </div>
    </NodeViewWrapper>
  );
}

export function CodeView({ node, editor, getPos }: NodeViewProps) {
  const number = useNumber(editor, getPos, 'listing');
  const language = String(node.attrs.language ?? 'texte');
  return (
    <NodeViewWrapper as="figure" className="fig" data-block="Code">
      <div className="code">
        <div className="code-head" contentEditable={false}>
          <span>{language}</span>
          <button type="button" className="icon-btn sm" aria-label="Copier le code" onClick={() => void navigator.clipboard.writeText(node.textContent)}>
            <CopyIcon size={16} aria-hidden />
          </button>
        </div>
        <pre>
          <NodeViewContent<'code'> as="code" />
        </pre>
      </div>
      <figcaption contentEditable={false}>
        <span className="fignum">Listing {number}</span>
        <span className="cap-text">{language === 'bash' ? 'Commande shell.' : `Code ${language}.`}</span>
      </figcaption>
    </NodeViewWrapper>
  );
}
