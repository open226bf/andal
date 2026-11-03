/**
 * Webhooks: format des messages (générique signé, Slack ou Mattermost, Teams)
 * et envoi protégé contre les requêtes vers le réseau interne (SSRF).
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, request } from 'undici';
import type { WebhookEvent, WebhookKind } from './schema.js';

export const WEBHOOK_EVENTS: WebhookEvent[] = ['page.created', 'page.updated', 'page.deleted', 'comment.created', 'spec.published'];

/** Un événement à diffuser, mis en file par l'API ou le worker; le contenu est relu au moment de l'envoi. */
export interface WebhookEventJob {
  event: WebhookEvent;
  workspaceId: string;
  projectId: string;
  actorId: string | null;
  pageId?: string;
  commentId?: string;
  specId?: string;
}

export interface WebhookPayload {
  id: string;
  event: WebhookEvent | 'ping';
  createdAt: string;
  actor: { id: string; name: string } | null;
  project: { id: string; slug: string; name: string } | null;
  page?: { id: string; title: string; url: string };
  comment?: { id: string; excerpt: string; url: string };
  spec?: { id: string; name: string; title: string; version: string; url: string };
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** La phrase affichée dans Slack, Mattermost ou Teams. */
export function webhookSentence(p: WebhookPayload): { text: string; url: string | null; label: string | null } {
  const who = p.actor?.name ?? 'Quelqu’un';
  const where = p.project ? ` · ${p.project.name}` : '';
  switch (p.event) {
    case 'page.created':
      return { text: `${who} a créé une page${where}`, url: p.page!.url, label: p.page!.title };
    case 'page.updated':
      return { text: `${who} a modifié une page${where}`, url: p.page!.url, label: p.page!.title };
    case 'page.deleted':
      return { text: `${who} a mis une page à la corbeille${where}`, url: null, label: p.page!.title };
    case 'comment.created':
      return { text: `${who} a commenté « ${p.page!.title} »${where} : ${p.comment!.excerpt}`, url: p.comment!.url, label: 'Ouvrir le fil' };
    case 'spec.published':
      return { text: `${who} a publié la spec ${p.spec!.name} v${p.spec!.version}${where}`, url: p.spec!.url, label: p.spec!.title };
    default:
      return { text: 'Andal: test de l’intégration réussi.', url: null, label: null };
  }
}

/** Échappe le texte pour Slack et Mattermost (`<`, `>` et `&` y ont un sens). */
const slackEscape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Corps et en-têtes de la requête, selon le type d'intégration. */
export function webhookRequest(kind: WebhookKind, secret: string, payload: WebhookPayload): { body: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'Andal-Webhooks/1' };
  if (kind === 'slack') {
    const s = webhookSentence(payload);
    const link = s.url && s.label ? `\n<${s.url}|${slackEscape(s.label)}>` : s.label ? `\n${slackEscape(s.label)}` : '';
    return { body: JSON.stringify({ text: slackEscape(s.text) + link }), headers };
  }
  if (kind === 'teams') {
    const s = webhookSentence(payload);
    const card = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        { type: 'TextBlock', text: s.text, wrap: true },
        ...(s.label ? [{ type: 'TextBlock', text: s.label, weight: 'Bolder', wrap: true }] : []),
      ],
      actions: s.url ? [{ type: 'Action.OpenUrl', title: 'Ouvrir dans Andal', url: s.url }] : [],
    };
    return { body: JSON.stringify({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }] }), headers };
  }
  // Générique: JSON signé. Vérification: HMAC-SHA256(secret, `${timestamp}.${corps}`).
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return {
    body,
    headers: { ...headers, 'x-andal-event': payload.event, 'x-andal-delivery': payload.id, 'x-andal-timestamp': timestamp, 'x-andal-signature': `sha256=${signature}` },
  };
}

export function pingPayload(): WebhookPayload {
  return { id: randomUUID(), event: 'ping', createdAt: new Date().toISOString(), actor: null, project: null };
}

/* ---------- Envoi ---------- */

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** Adresse interne (boucle locale, réseau privé, lien local, métadonnées cloud…) ? */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return blocked.check(mapped, 'ipv4');
  const family = isIP(address);
  return family === 4 ? blocked.check(address, 'ipv4') : family === 6 ? blocked.check(address, 'ipv6') : true;
}

/** URL acceptable pour un webhook: http(s), sans identifiants, 2 000 caractères au plus. Renvoie l'erreur, ou null. */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Adresse invalide.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Seules les adresses http(s) sont acceptées.';
  if (url.username || url.password) return 'Pas d’identifiants dans l’adresse: utilisez la signature pour authentifier les envois.';
  if (raw.length > 2000) return 'Adresse trop longue.';
  return null;
}

const agents = new Map<boolean, Agent>();

/**
 * Agent HTTP qui refuse, au moment de la connexion, toute adresse interne:
 * la vérification porte sur l'adresse réellement jointe (pas de contournement
 * par un DNS qui change de réponse entre deux résolutions).
 */
function agentFor(allowPrivate: boolean): Agent {
  let agent = agents.get(allowPrivate);
  if (!agent) {
    agent = new Agent({
      connect: {
        timeout: 5000,
        lookup: (hostname, options, callback) => {
          lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
            if (error) return callback(error, [] as never);
            const refused = !allowPrivate && addresses.some((a) => isPrivateAddress(a.address));
            if (refused) return callback(Object.assign(new Error(`Adresse interne refusée pour ${hostname}`), { code: 'EPRIVATE' }), [] as never);
            if ((options as { all?: boolean }).all) return callback(null, addresses as never);
            callback(null, addresses[0]!.address as never, addresses[0]!.family);
          });
        },
      },
    });
    agents.set(allowPrivate, agent);
  }
  return agent;
}

export interface DeliveryResult {
  status: number | null;
  error: string | null;
  durationMs: number;
  /** Vaut la peine de réessayer (réseau, 5xx, 429). */
  retry: boolean;
}

export async function deliverWebhook(url: string, body: string, headers: Record<string, string>, options: { allowPrivate: boolean }): Promise<DeliveryResult> {
  const started = Date.now();
  const problem = webhookUrlProblem(url);
  if (problem) return { status: null, error: problem, durationMs: 0, retry: false };
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (!options.allowPrivate && isIP(host) && isPrivateAddress(host)) return { status: null, error: 'Adresse interne refusée.', durationMs: 0, retry: false };
  try {
    const response = await request(url, { method: 'POST', body, headers, dispatcher: agentFor(options.allowPrivate), headersTimeout: 10_000, bodyTimeout: 10_000 });
    await response.body.dump({ limit: 64 * 1024 });
    const status = response.statusCode;
    const ok = status >= 200 && status < 300;
    return { status, error: ok ? null : `Réponse HTTP ${status}`, durationMs: Date.now() - started, retry: !ok && (status >= 500 || status === 429 || status === 408) };
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    const message = code === 'EPRIVATE' ? 'Adresse interne refusée.' : error instanceof Error ? error.message : String(error);
    return { status: null, error: message.slice(0, 300), durationMs: Date.now() - started, retry: code !== 'EPRIVATE' };
  }
}
