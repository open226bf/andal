import { BookOpenTextIcon, CaretRightIcon, CopyIcon, TerminalWindowIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '../components/AuthCard';
import { ConfirmDialog, type Confirmation } from '../components/Dialog';
import { Shelf } from '../components/Shelf';
import { api, errorMessage, publishSpec, useMe, useProjects, useSpec, useSpecDocument, type SpecDetail } from '../lib/api';
import { date } from '../lib/format';
import { loadRedoc, redocTheme } from '../lib/redoc';
import { usePaletteVersion } from '../lib/theme';
import { t, tn, tx } from '../lib/i18n';

/** Section Redoc d'une opération (« POST /oauth/token »), pour y arriver directement depuis une page. */
function sectionFor(doc: Record<string, unknown>, key: string): string | null {
  const match = /^(GET|POST|PUT|PATCH|DELETE) (\/.*)$/.exec(key);
  if (!match) return null;
  const [, method, path] = match as unknown as [string, string, string];
  const op = ((doc.paths as Record<string, Record<string, { operationId?: string; tags?: string[] }>> | undefined)?.[path] ?? {})[method.toLowerCase()];
  if (!op) return null;
  if (op.operationId) return `operation/${op.operationId}`;
  const pointer = path.replaceAll('~', '~0').replaceAll('/', '~1');
  return op.tags?.[0] ? `tag/${op.tags[0]}/paths/${pointer}/${method.toLowerCase()}` : `paths/${pointer}/${method.toLowerCase()}`;
}

/** Une spec OpenAPI du volume, rendue par Redoc: versions, publication, commande pour la CI. */
export function SpecPage({ specId, version, op }: { specId: string; version?: number; op?: string }) {
  const me = useMe();
  const projects = useProjects();
  const spec = useSpec(specId);
  const doc = useSpecDocument(specId, version);
  const palette = usePaletteVersion();
  const container = useRef<HTMLDivElement>(null);
  const [redocError, setRedocError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const app = useRef<HTMLDivElement>(null);

  // Le menu de Redoc colle sous la barre de la spec, dont la hauteur varie (commande CI ouverte, mobile).
  useEffect(() => {
    const bar = app.current?.querySelector<HTMLElement>('.spec-bar');
    if (!bar || !app.current) return;
    const root = app.current;
    const sync = () => root.style.setProperty('--spec-top', `${Math.max(0, bar.getBoundingClientRect().bottom)}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => observer.disconnect();
  });

  const project = spec.data?.project;
  const cloth = projects.data?.find((p) => p.id === project?.id)?.cloth;
  useEffect(() => {
    if (cloth) document.documentElement.dataset.vol = cloth;
  }, [cloth]);
  useEffect(() => {
    if (spec.data) document.title = `${spec.data.title} · ${t('Specs API')} · ${spec.data.project.shortName} · Andal`;
  }, [spec.data]);

  useEffect(() => {
    const element = container.current;
    if (!doc.data || !element) return;
    let alive = true;
    setReady(false);
    // Arriver depuis le bloc d'une page: Redoc lit l'ancre au démarrage et y descend.
    const section = op ? sectionFor(doc.data, op) : null;
    if (section) history.replaceState(history.state, '', `${location.pathname}${location.search}#${section}`);
    loadRedoc()
      .then((redoc) => {
        if (!alive) return;
        redoc.init(
          doc.data,
          {
            theme: redocTheme(),
            hideDownloadButton: true,
            expandResponses: '200,201',
            jsonSampleExpandLevel: 2,
            pathInMiddlePanel: true,
            sortPropsAlphabetically: false,
            nativeScrollbars: true,
            // Sous le bandeau et la barre de la spec, qui restent en haut de l'écran.
            scrollYOffset: () => document.querySelector('.spec-bar')?.getBoundingClientRect().bottom ?? 0,
          },
          element,
          (error) => {
            if (!alive) return;
            if (error) setRedocError(error instanceof Error ? error.message : t('Redoc ne lit pas cette spec.'));
            else setReady(true);
          },
        );
      })
      .catch((error: unknown) => alive && setRedocError(error instanceof Error ? error.message : String(error)));
    return () => {
      alive = false;
    };
  }, [doc.data, palette, op]);

  if (spec.isError || doc.isError) {
    return (
      <main className="missing-page">
        <BookOpenTextIcon size={28} aria-hidden />
        <h1>{t('Spec introuvable')}</h1>
        <p>{t('Cette spec a été supprimée, ou elle appartient à un volume que vous ne lisez pas.')}</p>
        <Link to="/" className="btn-line">
          {t('Retour à la bibliothèque')}
        </Link>
      </main>
    );
  }
  if (!me.data || !projects.data || !spec.data || !project) return null;
  const current = version ?? spec.data.versions[0]?.sequence;

  return (
    <div className="app admin-app spec-app" ref={app}>
      <div className="nav-wrap">
        <Shelf projects={projects.data} current={project.slug} me={me.data} />
      </div>
      <main className="main">
        <header className="band">
          <div className="band-vol">
            <span className="band-title">{project.shortName}</span>
          </div>
          <nav className="crumbs" aria-label={t("Fil d'Ariane")}>
            <Link to="/v/$slug" params={{ slug: project.slug }}>
              {project.name}
            </Link>
            <CaretRightIcon size={14} aria-hidden />
            <span>{t('Specs API')}</span>
            <CaretRightIcon size={14} aria-hidden />
            <span aria-current="page">{spec.data.name}</span>
          </nav>
        </header>
        <SpecBar spec={spec.data} current={current} onVersion={(v) => void navigate({ to: '/specs/$specId', params: { specId }, search: v === spec.data!.versions[0]?.sequence ? {} : { version: v } })} />
        {redocError && (
          <div className="spec-note">
            <FormError>{redocError}</FormError>
          </div>
        )}
        <div className="redoc-host" aria-busy={!ready}>
          <div ref={container} />
        </div>
      </main>
    </div>
  );
}

function SpecBar({ spec, current, onVersion }: { spec: SpecDetail; current: number | undefined; onVersion: (sequence: number) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [ciOpen, setCiOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const latest = spec.versions[0];
  const command = `curl -X POST -H "Authorization: Bearer $ANDAL_TOKEN" -H "Content-Type: application/yaml" --data-binary @openapi.yaml "${location.origin}/api/projects/${spec.project.id}/specs?name=${spec.name}"`;

  const publish = async (picked: File) => {
    setPending(true);
    setStatus(null);
    try {
      const result = await publishSpec(spec.project.id, picked, spec.name);
      await queryClient.invalidateQueries({ queryKey: ['specs'] });
      setStatus(result.unchanged ? { tone: 'ok', text: t('Identique à la dernière version: rien de nouveau.') } : { tone: 'ok', text: t('Version {version} publiée.', { version: result.label || result.sequence }) });
      if (!result.unchanged) onVersion(result.sequence);
    } catch (err) {
      setStatus({ tone: 'err', text: errorMessage(err) });
    } finally {
      setPending(false);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div className="spec-bar">
      <div className="spec-id">
        <h1>{spec.title}</h1>
        <label className="spec-version">
          <span className="sr-only">{t('Version')}</span>
          <select value={current} onChange={(e) => onVersion(Number(e.target.value))}>
            {spec.versions.map((v) => (
              <option key={v.sequence} value={v.sequence}>
                {v.label ? `v${v.label}` : t('n° {n}', { n: v.sequence })} · {date(v.createdAt)}
                {v.sequence === latest?.sequence ? ` · ${t('dernière')}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="spec-actions">
        {spec.canPublish && (
          <>
            <input ref={file} type="file" hidden accept=".yaml,.yml,.json,application/yaml,application/json" onChange={(e) => e.target.files?.[0] && void publish(e.target.files[0])} />
            <button type="button" className="btn-line sm" disabled={pending} onClick={() => file.current?.click()}>
              <UploadSimpleIcon size={16} aria-hidden />
              {t('Publier une version')}
            </button>
            <button type="button" className="btn-line sm" aria-expanded={ciOpen} onClick={() => setCiOpen((o) => !o)}>
              <TerminalWindowIcon size={16} aria-hidden />
              {t('Depuis la CI')}
            </button>
          </>
        )}
        {spec.canDelete && (
          <button
            type="button"
            className="icon-btn sm"
            aria-label={t('Supprimer la spec {name}', { name: spec.name })}
            title={t('Supprimer la spec')}
            onClick={() =>
              setConfirm({
                title: t('Supprimer la spec {name} ?', { name: spec.name }),
                body: tn(
                  spec.versions.length,
                  "Ses {n} version disparaissent. Les pages qui citent ses opérations gardent la copie qu'elles avaient.",
                  "Ses {n} versions disparaissent. Les pages qui citent ses opérations gardent la copie qu'elles avaient.",
                ),
                action: t('Supprimer'),
                run: async () => {
                  await api(`/specs/${spec.id}`, { method: 'DELETE' });
                  await queryClient.invalidateQueries({ queryKey: ['specs'] });
                  await navigate({ to: '/v/$slug', params: { slug: spec.project.slug } });
                },
              })
            }
          >
            <TrashIcon size={18} aria-hidden />
          </button>
        )}
      </div>
      {status && (
        <p className={`spec-status ${status.tone}`} role={status.tone === 'err' ? 'alert' : 'status'}>
          {status.text}
        </p>
      )}
      {ciOpen && (
        <div className="spec-ci">
          <p>{tx("Avec un jeton d'API (portée écriture) dans {env}, la CI publie à chaque version. Republier la même spec ne crée pas de version.", { env: <code>ANDAL_TOKEN</code> })}</p>
          <div className="spec-cmd">
            <pre>{command}</pre>
            <button type="button" className="icon-btn sm" aria-label={t('Copier la commande')} title={t('Copier')} onClick={() => void navigator.clipboard?.writeText(command)}>
              <CopyIcon size={16} aria-hidden />
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog confirmation={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
