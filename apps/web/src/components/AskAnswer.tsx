import { ArrowLeftIcon, SparkleIcon } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../lib/api';
import { askStream, type AskSource } from '../lib/ask';

/** Texte en ligne: `code`, **gras**, et citations [n] qui mènent à la page citée. */
function inline(text: string, sources: AskSource[], onOpen: () => void): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
    if (/^`[^`]+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <b key={i}>{part.slice(2, -2)}</b>;
    const cite = /^\[(\d+)\]$/.exec(part);
    const source = cite ? sources.find((s) => s.n === Number(cite[1])) : undefined;
    if (source) {
      return (
        <Link key={i} className="ask-cite" to="/v/$slug/$pageId" params={{ slug: source.project.slug, pageId: source.id }} onClick={onOpen} title={`${source.number} ${source.title}`} data-vol={source.project.cloth}>
          {source.n}
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Markdown léger de la réponse: paragraphes, listes, blocs de code. Rien n'est injecté en HTML. */
function render(text: string, sources: AskSource[], onOpen: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/```[\w-]*\n?/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(<pre key={`c${i}`}>{part.replace(/\n$/, '')}</pre>);
      return;
    }
    for (const [j, block] of part.split(/\n{2,}/).entries()) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (lines.length === 0) continue;
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
        out.push(
          <ul key={`l${i}-${j}`}>
            {lines.map((l, k) => (
              <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''), sources, onOpen)}</li>
            ))}
          </ul>,
        );
      } else {
        out.push(<p key={`p${i}-${j}`}>{inline(lines.join(' '), sources, onOpen)}</p>);
      }
    }
  });
  return out;
}

/** La réponse de l'assistant à une question, au fil de l'eau, avec ses sources. */
export function AskAnswer({ question, model, onBack, onOpen }: { question: string; model: string | null; onBack: () => void; onOpen: () => void }) {
  const [sources, setSources] = useState<AskSource[]>([]);
  const [text, setText] = useState('');
  const [state, setState] = useState<'loading' | 'streaming' | 'done' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const live = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    setSources([]);
    setText('');
    setState('loading');
    askStream(
      question,
      {
        onSources: setSources,
        onText: (t) => {
          setState('streaming');
          setText((prev) => prev + t);
        },
      },
      abort.signal,
    )
      .then(() => setState('done'))
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setError(errorMessage(err, 'L’assistant ne répond pas pour le moment.'));
        setState('error');
      });
    return () => abort.abort();
  }, [question]);

  return (
    <div className="ask">
      <div className="ask-head">
        <button type="button" className="icon-btn sm" aria-label="Revenir à la recherche" onClick={onBack}>
          <ArrowLeftIcon size={18} aria-hidden />
        </button>
        <SparkleIcon size={18} aria-hidden />
        <b>{question}</b>
      </div>
      <div className="ask-body" ref={live} aria-live="polite" aria-busy={state === 'loading' || state === 'streaming'}>
        {state === 'loading' && (
          <span className="doc-skeleton" aria-label="L’assistant lit les pages…">
            <span />
            <span />
            <span />
          </span>
        )}
        {text && <div className="ask-text">{render(text, sources, onOpen)}</div>}
        {state === 'error' && <p className="ask-error" role="alert">{error}</p>}
      </div>
      {sources.length > 0 && (
        <div className="ask-sources">
          <h3>Pages lues</h3>
          <ol>
            {sources.map((s) => (
              <li key={s.id} data-vol={s.project.cloth}>
                <Link to="/v/$slug/$pageId" params={{ slug: s.project.slug, pageId: s.id }} onClick={onOpen}>
                  <span className="ask-n">{s.n}</span>
                  <span className="num">{s.number}</span>
                  <span>
                    {s.title} <small>· {s.project.shortName}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
      {state === 'done' && (
        <p className="ask-foot">
          Réponse rédigée par {model ?? 'le modèle'} à partir des seules pages que vous lisez. Vérifiez dans les pages citées avant d’agir.
        </p>
      )}
    </div>
  );
}
