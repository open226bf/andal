import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { deliverWebhook, isPrivateAddress, pingPayload, webhookRequest, webhookUrlProblem, type WebhookPayload } from './webhooks.js';

const payload: WebhookPayload = {
  id: 'd1',
  event: 'comment.created',
  createdAt: '2026-11-03T10:00:00Z',
  actor: { id: 'u1', name: 'Aminata K.' },
  project: { id: 'p1', slug: 'paiements', name: 'Plateforme Paiements' },
  page: { id: 'pg', title: '3.2 <Auth> & jetons', url: 'https://doc.exemple/p/pg' },
  comment: { id: 'c1', excerpt: 'Précisons le format', url: 'https://doc.exemple/v/paiements/pg?fil=t1' },
};

describe('webhooks', () => {
  it('reconnaît les adresses internes, y compris en IPv6 et en IPv4 encapsulé', () => {
    for (const a of ['127.0.0.1', '10.2.3.4', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['1.1.1.1', '140.82.112.3', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(a), a).toBe(false);
  });

  it('refuse les adresses non http(s) ou avec identifiants', () => {
    expect(webhookUrlProblem('https://hooks.slack.com/services/x')).toBeNull();
    expect(webhookUrlProblem('ftp://exemple.org')).not.toBeNull();
    expect(webhookUrlProblem('https://moi:secret@exemple.org/')).not.toBeNull();
    expect(webhookUrlProblem('pas une adresse')).not.toBeNull();
  });

  it('signe le format générique: HMAC-SHA256 de « horodatage.corps »', () => {
    const { body, headers } = webhookRequest('generic', 'whsec_test', payload);
    const expected = createHmac('sha256', 'whsec_test').update(`${headers['x-andal-timestamp']}.${body}`).digest('hex');
    expect(headers['x-andal-signature']).toBe(`sha256=${expected}`);
    expect(headers['x-andal-event']).toBe('comment.created');
    expect(JSON.parse(body)).toEqual(payload);
  });

  it('écrit une phrase Slack échappée, avec le lien', () => {
    const { body } = webhookRequest('slack', 'x', { ...payload, event: 'page.created', comment: undefined });
    expect(JSON.parse(body).text).toBe('Aminata K. a créé une page · Plateforme Paiements\n<https://doc.exemple/p/pg|3.2 &lt;Auth&gt; &amp; jetons>');
  });

  it('écrit une carte adaptative pour Teams', () => {
    const { body } = webhookRequest('teams', 'x', payload);
    const card = JSON.parse(body).attachments[0].content;
    expect(card.type).toBe('AdaptiveCard');
    expect(card.actions[0].url).toBe(payload.comment!.url);
  });

  it('refuse d’envoyer vers le réseau interne, sauf autorisation', async () => {
    const server = createServer((_req, res) => res.writeHead(204).end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const { body, headers } = webhookRequest('generic', 'x', pingPayload());
      const refusedIp = await deliverWebhook(`http://127.0.0.1:${port}/`, body, headers, { allowPrivate: false });
      expect(refusedIp).toMatchObject({ status: null, error: 'Adresse interne refusée.', retry: false });
      const refusedName = await deliverWebhook(`http://localhost:${port}/`, body, headers, { allowPrivate: false });
      expect(refusedName).toMatchObject({ status: null, error: 'Adresse interne refusée.', retry: false });
      const allowed = await deliverWebhook(`http://localhost:${port}/`, body, headers, { allowPrivate: true });
      expect(allowed).toMatchObject({ status: 204, error: null });
    } finally {
      server.close();
    }
  });
});
