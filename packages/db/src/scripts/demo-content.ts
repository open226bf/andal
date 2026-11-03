import { operationFromSpec, type JSONContent } from '@andal/editor';
import { paymentsSpecVersions } from './demo-spec.js';

/** Contenu fictif de démonstration. Personnes, équipes et URL n'existent pas. */

const text = (value: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const code = (value: string) => text(value, [{ type: 'code' }]);
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const h2 = (value: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [text(value)] });
/** Lien vers une page d'Andal: adresse stable /p/<id>. */
const pageLink = (value: string, pageId: string) => text(value, [{ type: 'link', attrs: { href: `/p/${pageId}` } }]);
const cell = (kind: 'tableHeader' | 'tableCell', ...content: JSONContent[]): JSONContent => ({ type: kind, content: [p(...content)] });
const row = (kind: 'tableHeader' | 'tableCell', ...cells: (string | JSONContent)[]): JSONContent => ({
  type: 'tableRow',
  content: cells.map((c) => cell(kind, typeof c === 'string' ? text(c) : c)),
});
const task = (checked: boolean, ...content: JSONContent[]): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [p(...content)] });

export function simplePage(intro: string): JSONContent {
  return { type: 'doc', content: [p(text(intro))] };
}

const tokenOperation = operationFromSpec(paymentsSpecVersions[1], 'POST /oauth/token')!;

export function authenticationPage(threads: { header: string; storage: string }, links: { userTokens: string; runbook: string }, specId: string): JSONContent {
  return {
    type: 'doc',
    content: [
      p(
        text("Tous les appels à l'API Paiements exigent un jeton d'accès OAuth 2.0. Un service client l'obtient auprès du service Auth avec ses propres identifiants, puis l'envoie dans "),
        text("l'en-tête ", [{ type: 'comment', attrs: { threadId: threads.header } }]),
        text('Authorization', [{ type: 'comment', attrs: { threadId: threads.header } }, { type: 'code' }]),
        text(' de chaque requête.'),
      ),
      p(text("Ce flux ne concerne que les échanges entre machines. Les applications qui agissent au nom d'une personne utilisent des "), pageLink('jetons utilisateur', links.userTokens), text(', décrits en 3.4.')),
      h2('Obtenir un jeton'),
      p(text('Le service client envoie ses identifiants à la passerelle, qui les transmet au service Auth. Celui-ci vérifie le secret dans le coffre, puis signe un jeton valable quinze minutes.')),
      {
        type: 'mermaid',
        attrs: {
          caption: "Échange des identifiants client contre un jeton d'accès.",
          source: [
            'sequenceDiagram',
            '  autonumber',
            '  participant C as Service client',
            '  participant P as Passerelle API',
            '  participant A as Service Auth',
            '  participant V as Coffre',
            '  C->>P: POST /oauth/token',
            '  P->>A: Identifiants',
            '  A->>V: Lit le secret',
            '  V-->>A: Secret haché',
            '  A-->>P: Jeton signé, 15 min',
            '  P-->>C: 200 access_token',
          ].join('\n'),
        },
      },
      p(text('En pratique, une seule requête suffit:')),
      {
        type: 'codeBlock',
        attrs: { language: 'bash' },
        content: [
          text(
            [
              'curl -X POST https://api.paiements.exemple/oauth/token \\',
              '  -d grant_type=client_credentials \\',
              '  -d client_id=$CLIENT_ID \\',
              '  -d client_secret=$CLIENT_SECRET \\',
              '  -d scope=paiements:lecture',
            ].join('\n'),
          ),
        ],
      },
      {
        type: 'callout',
        attrs: { tone: 'note', title: 'À retenir' },
        content: [
          p(
            text('Un jeton expire au bout de 15 minutes. Gardez-le en mémoire côté serveur et '),
            text('ne le stockez jamais côté navigateur', [{ type: 'comment', attrs: { threadId: threads.storage } }]),
            text('.'),
          ),
        ],
      },
      h2("Référence de l'endpoint"),
      p(text('La référence ci-dessous vient de la spec '), code('paiements'), text(", que la CI publie à chaque version de l'API. Personne ne la recopie à la main.")),
      {
        type: 'openapi',
        attrs: {
          specId,
          operationKey: 'POST /oauth/token',
          specFile: 'paiements',
          specVersion: null,
          operation: tokenOperation,
          caption: 'Extrait de la spec paiements, publiée par la CI.',
        },
      },
      h2('Erreurs fréquentes'),
      p(text("Le service Auth ne distingue pas un client inconnu d'un secret faux: les deux répondent 401, pour ne rien révéler.")),
      {
        type: 'table',
        content: [
          row('tableHeader', 'Code', 'Cause', 'Que faire'),
          row('tableCell', text('400', [{ type: 'code' }]), text('grant_type', [{ type: 'code' }]), 'Envoyer client_credentials, rien d’autre.'),
          row('tableCell', text('401', [{ type: 'code' }]), 'Client inconnu ou secret faux', 'Vérifier le secret dans le coffre, puis le faire tourner s’il a fuité.'),
          row('tableCell', text('429', [{ type: 'code' }]), 'Plus de 10 jetons par minute', 'Garder le jeton en mémoire jusqu’à son expiration.'),
          row('tableCell', text('503', [{ type: 'code' }]), 'Coffre injoignable', 'Réessayer avec un délai croissant; au-delà de 5 minutes, ouvrir le runbook.'),
        ],
      },
      p(text('Une panne du service Auth se traite avec le '), pageLink('runbook incident', links.runbook), text('.')),
      h2('Où passe le trafic'),
      p(text('Le jeton ne sort jamais du réseau privé. Seule la passerelle est exposée, derrière Caddy, et chaque service vérifie la signature du jeton avant de répondre.')),
      {
        type: 'drawio',
        attrs: {
          src: '/demo/topologie-paiements.svg',
          xml: null,
          alt: 'Topologie: Internet vers Caddy, puis la passerelle API dans le réseau privé, qui dessert le service Auth et le service Paiements.',
          caption: "Topologie réseau. Diagramme draw.io, modifiable dans l'éditeur intégré.",
        },
      },
    ],
  };
}

/** Le runbook: une check-list que l'astreinte coche pendant l'incident. */
export function runbookPage(links: { auth: string }): JSONContent {
  return {
    type: 'doc',
    content: [
      p(text("À suivre dès qu'une alerte « Paiements indisponibles » sonne. Cochez au fil de l'eau: l'équipe voit où vous en êtes.")),
      h2('Premières minutes'),
      {
        type: 'taskList',
        content: [
          task(true, text('Prendre l’incident dans l’outil d’astreinte.')),
          task(true, text('Ouvrir le canal '), code('#inc-paiements'), text(' et y annoncer la prise en charge.')),
          task(false, text('Vérifier la passerelle, puis le service Auth (voir '), pageLink('l’authentification', links.auth), text(').')),
          task(false, text('Prévenir le support si l’incident dure plus de 15 minutes.')),
        ],
      },
      h2('Après l’incident'),
      {
        type: 'taskList',
        content: [task(false, text('Rédiger le post-mortem sous 48 heures.')), task(false, text('Reporter les actions dans le backlog de l’équipe.'))],
      },
    ],
  };
}
