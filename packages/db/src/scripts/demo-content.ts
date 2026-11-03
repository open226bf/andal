import type { ApiOperation, JSONContent } from '@andal/editor';

/** Contenu fictif de démonstration. Personnes, équipes et URL n'existent pas. */

const text = (value: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const code = (value: string) => text(value, [{ type: 'code' }]);
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const h2 = (value: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [text(value)] });

export function simplePage(intro: string): JSONContent {
  return { type: 'doc', content: [p(text(intro))] };
}

const tokenOperation: ApiOperation = {
  method: 'POST',
  path: '/oauth/token',
  summary: "Émet un jeton d'accès",
  contentType: 'application/x-www-form-urlencoded',
  requestBody: [
    { name: 'grant_type', type: 'string', required: true, description: 'Toujours client_credentials.' },
    { name: 'client_id', type: 'string', required: true, description: 'Identifiant du service client.' },
    { name: 'client_secret', type: 'string', required: true, description: 'Secret du service client.' },
    { name: 'scope', type: 'string', description: 'Portées séparées par des espaces.' },
  ],
  responses: [
    { status: 200, description: 'Jeton émis', example: '{\n  "access_token": "eyJhbGciOi…",\n  "token_type": "Bearer",\n  "expires_in": 900\n}' },
    { status: 400, description: 'Requête invalide' },
    { status: 401, description: 'Client inconnu ou secret faux' },
    { status: 429, description: 'Trop de requêtes' },
  ],
};

export function authenticationPage(threads: { header: string; storage: string }): JSONContent {
  return {
    type: 'doc',
    content: [
      p(
        text("Tous les appels à l'API Paiements exigent un jeton d'accès OAuth 2.0. Un service client l'obtient auprès du service Auth avec ses propres identifiants, puis l'envoie dans "),
        text("l'en-tête ", [{ type: 'comment', attrs: { threadId: threads.header } }]),
        text('Authorization', [{ type: 'comment', attrs: { threadId: threads.header } }, { type: 'code' }]),
        text(' de chaque requête.'),
      ),
      p(text("Ce flux ne concerne que les échanges entre machines. Les applications qui agissent au nom d'une personne utilisent des jetons utilisateur, décrits en 3.4.")),
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
      p(text('La référence ci-dessous est générée depuis '), code('paiements.yaml'), text(", que la CI publie à chaque version de l'API. Personne ne la recopie à la main.")),
      {
        type: 'openapi',
        attrs: {
          specFile: 'paiements.yaml',
          specVersion: '2.3',
          operation: tokenOperation,
          caption: 'Extrait de paiements.yaml v2.3, publié par la CI.',
        },
      },
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
