/** Spec OpenAPI fictive du volume Paiements, telle que la CI la publierait. Les URL n'existent pas. */

const problem = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', description: 'Code stable, à tester dans le code client.' },
    message: { type: 'string', description: 'Explication lisible, en français.' },
  },
};

const payment = {
  type: 'object',
  required: ['id', 'montant', 'devise', 'statut'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    montant: { type: 'integer', format: 'int64', description: 'En unités mineures (centimes).' },
    devise: { type: 'string', enum: ['XOF', 'EUR', 'USD'] },
    statut: { type: 'string', enum: ['en_attente', 'accepte', 'refuse', 'rembourse'] },
    reference: { type: 'string', description: 'Référence du commerçant, reprise sur le relevé.' },
    cree_le: { type: 'string', format: 'date-time' },
  },
  example: { id: '3f1c9a4e-5b8d-4c2a-9e71-0d6b2f8a1c35', montant: 125000, devise: 'XOF', statut: 'accepte', reference: 'CMD-2026-0412', cree_le: '2026-10-30T09:14:00Z' },
};

const errors = {
  '400': { description: 'Requête invalide', content: { 'application/json': { schema: { $ref: '#/components/schemas/Probleme' } } } },
  '401': { description: 'Jeton absent ou expiré', content: { 'application/json': { schema: { $ref: '#/components/schemas/Probleme' } } } },
};

function spec(version: string, withRefunds: boolean): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'API Paiements',
      version,
      description: "Encaisser, suivre et rembourser des paiements. Toutes les routes exigent un jeton d'accès OAuth 2.0 (flux client_credentials).",
    },
    servers: [{ url: 'https://api.paiements.exemple' }],
    tags: [
      { name: 'Auth', description: "Jetons d'accès des services clients." },
      { name: 'Paiements', description: 'Encaissement et suivi.' },
      ...(withRefunds ? [{ name: 'Remboursements', description: 'Remboursements totaux ou partiels.' }] : []),
    ],
    paths: {
      '/oauth/token': {
        post: {
          tags: ['Auth'],
          operationId: 'emettreJeton',
          summary: "Émet un jeton d'accès",
          security: [],
          requestBody: {
            required: true,
            content: { 'application/x-www-form-urlencoded': { schema: { $ref: '#/components/schemas/DemandeJeton' } } },
          },
          responses: {
            '200': {
              description: 'Jeton émis',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Jeton' }, example: { access_token: 'eyJhbGciOi…', token_type: 'Bearer', expires_in: 900 } } },
            },
            '400': { description: 'Requête invalide' },
            '401': { description: 'Client inconnu ou secret faux' },
            '429': { description: 'Trop de requêtes' },
          },
        },
      },
      '/paiements': {
        get: {
          tags: ['Paiements'],
          operationId: 'listerPaiements',
          summary: 'Liste les paiements',
          parameters: [
            { name: 'statut', in: 'query', schema: { type: 'string', enum: ['en_attente', 'accepte', 'refuse', 'rembourse'] } },
            { name: 'apres', in: 'query', description: 'Curseur renvoyé par la page précédente.', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Une page de paiements', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Paiement' } } } } },
            '401': errors['401'],
          },
        },
        post: {
          tags: ['Paiements'],
          operationId: 'creerPaiement',
          summary: 'Encaisse un paiement',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, description: 'Une valeur par paiement: rejouer la requête ne débite pas deux fois.', schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['montant', 'devise', 'moyen'],
                  properties: {
                    montant: { type: 'integer', format: 'int64', description: 'En unités mineures (centimes).' },
                    devise: { type: 'string', enum: ['XOF', 'EUR', 'USD'] },
                    moyen: { type: 'string', enum: ['carte', 'mobile_money', 'virement'] },
                    reference: { type: 'string', description: 'Référence du commerçant.' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Paiement créé', content: { 'application/json': { schema: { $ref: '#/components/schemas/Paiement' } } } },
            ...errors,
            '409': { description: 'Même Idempotency-Key, corps différent' },
          },
        },
      },
      '/paiements/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        get: {
          tags: ['Paiements'],
          operationId: 'lirePaiement',
          summary: 'Lit un paiement',
          responses: {
            '200': { description: 'Le paiement', content: { 'application/json': { schema: { $ref: '#/components/schemas/Paiement' } } } },
            '401': errors['401'],
            '404': { description: 'Aucun paiement avec cet identifiant' },
          },
        },
      },
      ...(withRefunds
        ? {
            '/paiements/{id}/remboursements': {
              parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
              post: {
                tags: ['Remboursements'],
                operationId: 'rembourser',
                summary: 'Rembourse tout ou partie',
                requestBody: {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          montant: { type: 'integer', format: 'int64', description: 'Absent: remboursement total.' },
                          motif: { type: 'string' },
                        },
                      },
                    },
                  },
                },
                responses: {
                  '202': { description: 'Remboursement accepté, traité sous 48 h' },
                  ...errors,
                  '422': { description: 'Montant supérieur au reste à rembourser' },
                },
              },
            },
          }
        : {}),
    },
    components: {
      schemas: {
        DemandeJeton: {
          type: 'object',
          required: ['grant_type', 'client_id', 'client_secret'],
          properties: {
            grant_type: { type: 'string', description: 'Toujours client_credentials.' },
            client_id: { type: 'string', description: 'Identifiant du service client.' },
            client_secret: { type: 'string', description: 'Secret du service client.' },
            scope: { type: 'string', description: 'Portées séparées par des espaces.' },
          },
        },
        Jeton: {
          type: 'object',
          properties: {
            access_token: { type: 'string' },
            token_type: { type: 'string', enum: ['Bearer'] },
            expires_in: { type: 'integer', description: 'Durée de validité en secondes.' },
          },
        },
        Paiement: payment,
        Probleme: problem,
      },
      securitySchemes: {
        oauth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: '/oauth/token', scopes: { 'paiements:lecture': 'Lire les paiements', 'paiements:ecriture': 'Encaisser et rembourser' } } } },
      },
    },
    security: [{ oauth: ['paiements:lecture'] }],
  };
}

/** Les deux publications de la démo: 2.2, puis 2.3 qui ajoute les remboursements. */
export const paymentsSpecVersions = [spec('2.2', false), spec('2.3', true)];
