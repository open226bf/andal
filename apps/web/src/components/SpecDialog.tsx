import { ArrowLeftIcon, FileCodeIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, errorMessage, publishSpec, useProjectSpecs, useSpecOperations, type LiveOperation, type SpecOperationRef, type SpecSummary } from '../lib/api';
import { FormError } from './AuthCard';

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Insérer une opération d'une spec du volume: choisir la spec (ou en envoyer
 * une), puis l'opération. Le bloc suit ensuite la dernière version de la spec.
 */
export function SpecDialog({ editor, open, onOpenChange, projectId }: { editor: Editor; open: boolean; onOpenChange: (open: boolean) => void; projectId: string }) {
  const specs = useProjectSpecs(open ? projectId : null);
  const [spec, setSpec] = useState<SpecSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPending(false);
    setSpec(null);
  }, [open]);

  // Une seule spec dans le volume: on passe directement à ses opérations.
  const only = specs.data?.specs.length === 1 ? specs.data.specs[0] : undefined;
  useEffect(() => {
    if (open && only && !specs.data?.canPublish) setSpec(only);
  }, [open, only, specs.data?.canPublish]);

  const upload = async (picked: File) => {
    setPending(true);
    setError(null);
    try {
      const result = await publishSpec(projectId, picked);
      const list = await queryClient.fetchQuery({ queryKey: ['specs', 'project', projectId], queryFn: () => api<{ specs: SpecSummary[] }>(`/projects/${projectId}/specs`), staleTime: 0 });
      setSpec(list.specs.find((s) => s.id === result.id) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
      if (file.current) file.current.value = '';
    }
  };

  const insert = async (target: SpecSummary, operation: SpecOperationRef) => {
    setPending(true);
    try {
      const live = await api<LiveOperation>(`/specs/${target.id}/operation?key=${encodeURIComponent(operation.key)}`);
      onOpenChange(false);
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'openapi',
          attrs: { specId: target.id, operationKey: operation.key, specFile: target.name, specVersion: null, operation: live.operation, caption: `${operation.summary || operation.key}, spec ${target.name}.` },
        })
        .run();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="pop search-dialog spec-dialog" aria-describedby={undefined} onCloseAutoFocus={(e) => e.preventDefault()}>
          {spec ? (
            <OperationPicker spec={spec} pending={pending} error={error} onBack={() => setSpec(null)} onPick={(op) => void insert(spec, op)} />
          ) : (
            <>
              <div className="pop-head">
                <Dialog.Title asChild>
                  <h2>Opération d'une spec OpenAPI</h2>
                </Dialog.Title>
              </div>
              <div className="spec-pick">
                {error && <FormError>{error}</FormError>}
                {specs.data?.specs.length ? (
                  <ul className="spec-list" aria-label="Specs du volume">
                    {specs.data.specs.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => setSpec(s)}>
                          <FileCodeIcon size={20} aria-hidden />
                          <span>
                            <b>{s.title}</b>
                            <small>
                              {s.name} · v{s.label || s.sequence} · {s.operationCount} opération{s.operationCount > 1 ? 's' : ''}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="dialog-text">{specs.isLoading ? 'Chargement…' : 'Ce volume n’a pas encore de spec. Envoyez la vôtre (YAML ou JSON, OpenAPI 3) ou publiez-la depuis la CI.'}</p>
                )}
                {specs.data?.canPublish && (
                  <>
                    <input ref={file} type="file" hidden accept=".yaml,.yml,.json,application/yaml,application/json" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
                    <button type="button" className="btn-line sm" disabled={pending} onClick={() => file.current?.click()}>
                      <UploadSimpleIcon size={16} aria-hidden />
                      {pending ? 'Envoi…' : 'Envoyer une spec'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OperationPicker({ spec, pending, error, onBack, onPick }: { spec: SpecSummary; pending: boolean; error: string | null; onBack: () => void; onPick: (op: SpecOperationRef) => void }) {
  const operations = useSpecOperations(spec.id);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const words = fold(query).split(/\s+/).filter(Boolean);
  const options = (operations.data ?? []).filter((op) => {
    const hay = fold(`${op.key} ${op.summary} ${op.tags.join(' ')}`);
    return words.every((w) => hay.includes(w));
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') setActive((i) => Math.min(i + 1, options.length - 1));
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (event.key === 'Enter' && options[active]) onPick(options[active]);
    else return;
    event.preventDefault();
  };

  return (
    <>
      <Dialog.Title className="sr-only">Opération de {spec.title}</Dialog.Title>
      <div className="spec-search">
        <button type="button" className="icon-btn sm" aria-label="Revenir aux specs" onClick={onBack}>
          <ArrowLeftIcon size={18} aria-hidden />
        </button>
        <input
          className="search-input"
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
          aria-label={`Opération de ${spec.title}`}
          placeholder={`Chercher dans ${spec.title} (route, verbe, résumé)…`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {error && <FormError>{error}</FormError>}
      <ul className="search-results" role="listbox" id={listId} aria-label="Opérations" aria-busy={operations.isFetching || pending}>
        {options.map((op, i) => (
          <li key={op.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => onPick(op)}>
            <span className="op-option">
              <span className="verb" data-method={op.method}>
                {op.method}
              </span>
              <code>{op.path}</code>
              <span className="op-sum">{op.summary}</span>
            </span>
          </li>
        ))}
        {options.length === 0 && (
          <li className="search-empty" role="presentation">
            {operations.isLoading ? 'Chargement…' : 'Aucune opération ne correspond.'}
          </li>
        )}
      </ul>
    </>
  );
}
