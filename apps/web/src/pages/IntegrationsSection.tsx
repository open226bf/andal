import { ArrowsClockwiseIcon, BroadcastIcon, ListMagnifyingGlassIcon, PaperPlaneTiltIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError, FormOk } from '../components/AuthCard';
import { CopyField } from '../components/CopyField';
import { ConfirmDialog, Modal, type Confirmation } from '../components/Dialog';
import { api, errorMessage, useProjects, useWebhookDeliveries, useWebhooks, type Webhook, type WebhookKind } from '../lib/api';
import { dateTime, relative } from '../lib/format';

const KINDS: Record<WebhookKind, { label: string; help: string }> = {
  slack: { label: 'Slack ou Mattermost', help: 'Collez l’URL d’un « Incoming Webhook » du canal. Chaque événement y arrive en une phrase, avec le lien.' },
  teams: { label: 'Microsoft Teams', help: 'Collez l’URL d’un flux Workflows « Publier sur un canal quand une requête webhook est reçue ». Le message arrive en carte.' },
  generic: { label: 'Webhook signé (JSON)', help: 'Pour vos propres services: un JSON par événement, signé HMAC-SHA256 dans X-Andal-Signature.' },
};

const EVENTS: Record<string, string> = {
  'page.created': 'Page créée',
  'page.updated': 'Page modifiée (une fois par rafale)',
  'page.deleted': 'Page mise à la corbeille',
  'comment.created': 'Nouveau commentaire',
  'spec.published': 'Spec OpenAPI publiée',
};

/** Statut du dernier envoi, en mots et en couleur. */
function DeliveryStatus({ delivery }: { delivery: Webhook['lastDelivery'] }) {
  if (!delivery) return <span className="hook-state">Aucun envoi pour l’instant</span>;
  const ok = delivery.status !== null && delivery.status >= 200 && delivery.status < 300;
  return (
    <span className={`hook-state ${ok ? 'ok' : 'err'}`} title={dateTime(delivery.at)}>
      {ok ? `Dernier envoi réussi ${relative(delivery.at)}` : `Dernier envoi en échec ${relative(delivery.at)}: ${delivery.error ?? delivery.status}`}
    </span>
  );
}

/**
 * Intégrations de l'espace: Slack, Mattermost, Teams ou un service à vous.
 * Les pages sous restriction de lecture ne sont jamais annoncées.
 */
export function IntegrationsSection() {
  const hooks = useWebhooks();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [journal, setJournal] = useState<Webhook | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState<{ id: string; tone: 'ok' | 'err'; text: string } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] });

  if (hooks.isPending) return <div className="doc-skeleton" aria-busy="true" aria-label="Chargement des intégrations"><span /><span /><span /></div>;
  if (hooks.isError) return <FormError>{errorMessage(hooks.error, 'Impossible de charger les intégrations.')}</FormError>;
  const list = hooks.data.webhooks;

  const test = async (hook: Webhook) => {
    setNotice({ id: hook.id, tone: 'ok', text: 'Envoi du test…' });
    try {
      const result = await api<{ status: number | null; error: string | null; durationMs: number }>(`/admin/webhooks/${hook.id}/test`, { method: 'POST' });
      setNotice(result.error ? { id: hook.id, tone: 'err', text: `Échec: ${result.error}` } : { id: hook.id, tone: 'ok', text: `Reçu: HTTP ${result.status}, en ${result.durationMs} ms.` });
    } catch (err) {
      setNotice({ id: hook.id, tone: 'err', text: errorMessage(err) });
    }
    await refresh();
  };

  const toggle = async (hook: Webhook) => {
    try {
      await api(`/admin/webhooks/${hook.id}`, { method: 'PATCH', body: JSON.stringify({ active: !hook.active }) });
      await refresh();
    } catch (err) {
      setNotice({ id: hook.id, tone: 'err', text: errorMessage(err) });
    }
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1 className="doc-title">Intégrations</h1>
          <p className="admin-count">
            {list.length === 0 ? 'Aucune intégration' : `${list.filter((h) => h.active).length} active${list.filter((h) => h.active).length > 1 ? 's' : ''} sur ${list.length}`}
          </p>
        </div>
        <button type="button" className="btn-ink" onClick={() => setCreateOpen(true)}>
          <PlusIcon size={18} aria-hidden />
          Nouvelle intégration
        </button>
      </div>
      {list.length === 0 ? (
        <div className="hooks-empty">
          <BroadcastIcon size={28} aria-hidden />
          <p>Prévenez un canal Slack, Mattermost ou Teams quand une page est créée, modifiée ou commentée, ou quand la CI publie une spec. Les pages sous restriction de lecture ne sont jamais annoncées.</p>
        </div>
      ) : (
        <ul className="hooks">
          {list.map((hook) => (
            <li key={hook.id} className="hook" data-off={hook.active ? undefined : 'true'}>
              <div className="hook-main">
                <div className="hook-title">
                  <b>{hook.name}</b>
                  <span className="hook-kind">{KINDS[hook.kind].label}</span>
                  {!hook.active && <span className="badge-off">En pause</span>}
                </div>
                <code className="hook-url">{hook.url.replace(/^https?:\/\//, '').replace(/(.{48}).+/, '$1…')}</code>
                <p className="hook-scope">
                  {hook.project ? `Volume ${hook.project.name}` : 'Tout l’espace'} · {hook.events.map((e) => EVENTS[e] ?? e).join(', ')}
                </p>
                <DeliveryStatus delivery={hook.lastDelivery} />
                {notice?.id === hook.id && (notice.tone === 'ok' ? <FormOk>{notice.text}</FormOk> : <FormError>{notice.text}</FormError>)}
                {hook.secret && (
                  <div className="hook-secret">
                    <span>Clé de signature</span>
                    {revealed.has(hook.id) ? (
                      <CopyField label="Clé de signature" value={hook.secret} />
                    ) : (
                      <button type="button" className="btn-line sm" onClick={() => setRevealed(new Set([...revealed, hook.id]))}>
                        Afficher
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="hook-actions">
                <button type="button" className="btn-line sm" onClick={() => void test(hook)}>
                  <PaperPlaneTiltIcon size={16} aria-hidden />
                  Tester
                </button>
                <button type="button" className="btn-line sm" onClick={() => setJournal(hook)}>
                  <ListMagnifyingGlassIcon size={16} aria-hidden />
                  Journal
                </button>
                <button type="button" className="btn-line sm" onClick={() => void toggle(hook)}>
                  {hook.active ? 'Mettre en pause' : 'Réactiver'}
                </button>
                {hook.secret && (
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={`Renouveler la clé de ${hook.name}`}
                    title="Renouveler la clé"
                    onClick={() =>
                      setConfirm({
                        title: `Renouveler la clé de « ${hook.name} » ?`,
                        body: 'L’ancienne clé cesse aussitôt de valoir: le service destinataire doit vérifier avec la nouvelle.',
                        action: 'Renouveler',
                        run: async () => {
                          await api(`/admin/webhooks/${hook.id}/rotate`, { method: 'POST' });
                          setRevealed(new Set([...revealed, hook.id]));
                          await refresh();
                        },
                      })
                    }
                  >
                    <ArrowsClockwiseIcon size={18} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn sm"
                  aria-label={`Supprimer ${hook.name}`}
                  title="Supprimer"
                  onClick={() =>
                    setConfirm({
                      title: `Supprimer « ${hook.name} » ?`,
                      body: 'Plus aucun événement ne partira vers cette adresse. Son journal disparaît aussi.',
                      action: 'Supprimer',
                      run: async () => {
                        await api(`/admin/webhooks/${hook.id}`, { method: 'DELETE' });
                        await refresh();
                      },
                    })
                  }
                >
                  <TrashIcon size={18} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CreateWebhook open={createOpen} onOpenChange={setCreateOpen} events={hooks.data.events} onCreated={refresh} />
      <DeliveriesDialog hook={journal} onClose={() => setJournal(null)} />
      <ConfirmDialog confirmation={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function CreateWebhook({ open, onOpenChange, events, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; events: string[]; onCreated: () => Promise<unknown> }) {
  const projects = useProjects();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WebhookKind>('slack');
  const [url, setUrl] = useState('');
  const [projectId, setProjectId] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set(['page.created', 'comment.created']));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/admin/webhooks', { method: 'POST', body: JSON.stringify({ name, kind, url, projectId: projectId || null, events: [...chosen] }) });
      await onCreated();
      onOpenChange(false);
      setName('');
      setUrl('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Nouvelle intégration">
      <form className="dialog-body" onSubmit={(e) => void submit(e)}>
        {error && <FormError>{error}</FormError>}
        <div className="field">
          <label htmlFor="hook-kind">Destination</label>
          <select id="hook-kind" className="input select" value={kind} onChange={(e) => setKind(e.target.value as WebhookKind)}>
            {(Object.keys(KINDS) as WebhookKind[]).map((k) => (
              <option key={k} value={k}>
                {KINDS[k].label}
              </option>
            ))}
          </select>
          <p className="field-help">{KINDS[kind].help}</p>
        </div>
        <div className="field">
          <label htmlFor="hook-url">Adresse du webhook</label>
          <input id="hook-url" className="input" type="url" required placeholder="https://hooks.slack.com/services/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hook-name">Nom</label>
          <input id="hook-name" className="input" required maxLength={80} placeholder="Canal #paiements" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="hook-volume">Volumes</label>
          <select id="hook-volume" className="input select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Tout l’espace</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="field hook-events">
          <legend>Événements</legend>
          {events.map((e) => (
            <label key={e} className="check">
              <input
                type="checkbox"
                checked={chosen.has(e)}
                onChange={(ev) => {
                  const next = new Set(chosen);
                  if (ev.target.checked) next.add(e);
                  else next.delete(e);
                  setChosen(next);
                }}
              />
              {EVENTS[e] ?? e}
            </label>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <Dialog.Close className="btn-line">Annuler</Dialog.Close>
          <button type="submit" className="btn-ink" disabled={pending || chosen.size === 0}>
            Créer
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeliveriesDialog({ hook, onClose }: { hook: Webhook | null; onClose: () => void }) {
  const deliveries = useWebhookDeliveries(hook?.id ?? null);
  return (
    <Modal open={hook !== null} onOpenChange={(open) => !open && onClose()} title={`Journal · ${hook?.name ?? ''}`}>
      <div className="dialog-body">
        {deliveries.data?.length ? (
          <table className="roster deliveries">
            <thead>
              <tr>
                <th scope="col">Quand</th>
                <th scope="col">Événement</th>
                <th scope="col">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data.map((d) => {
                const ok = d.status !== null && d.status >= 200 && d.status < 300;
                return (
                  <tr key={d.id}>
                    <td title={dateTime(d.at)}>{relative(d.at)}</td>
                    <td>
                      <code>{d.event}</code>
                      {d.attempt > 1 && <small> · tentative {d.attempt}</small>}
                    </td>
                    <td className={ok ? 'ok' : 'err'}>
                      {ok ? `HTTP ${d.status}` : (d.error ?? `HTTP ${d.status}`)}
                      {d.durationMs !== null && <small> · {d.durationMs} ms</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="dialog-text">{deliveries.isPending ? 'Chargement…' : 'Aucun envoi pour l’instant. « Tester » en envoie un.'}</p>
        )}
        <p className="field-help">Un envoi en échec (réseau, 5xx, 429) est réessayé 5 fois, de 30 secondes à 8 minutes d’intervalle.</p>
      </div>
    </Modal>
  );
}
