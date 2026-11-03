import { describe, expect, it } from 'vitest';
import { checkSpec, listOperations, operationFromSpec, specInfo } from './openapi.js';

const spec = {
  openapi: '3.1.0',
  info: { title: 'API Paiements', version: '2.3' },
  paths: {
    '/oauth/token': {
      post: {
        summary: "Obtenir un jeton d'accès",
        tags: ['Auth'],
        requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { $ref: '#/components/schemas/TokenRequest' } } } },
        responses: {
          '401': { $ref: '#/components/responses/Unauthorized' },
          '200': { description: 'Jeton émis', content: { 'application/json': { example: { access_token: 'eyJ…', expires_in: 900 } } } },
        },
      },
    },
    '/paiements/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: { operationId: 'lirePaiement', parameters: [{ name: 'expand', in: 'query', schema: { type: 'array', items: { type: 'string' } } }], responses: { '200': { description: 'Le paiement' } } },
    },
  },
  components: {
    schemas: {
      TokenRequest: {
        type: 'object',
        required: ['grant_type', 'client_id'],
        properties: {
          grant_type: { type: 'string', enum: ['client_credentials'], description: 'Toujours client_credentials.' },
          client_id: { type: 'string', description: 'Identifiant du service client.' },
          scope: { type: 'string' },
        },
      },
    },
    responses: { Unauthorized: { description: 'Client inconnu ou secret faux' } },
  },
};

describe('specs OpenAPI', () => {
  it('reconnaît une spec OpenAPI 3 et refuse le reste', () => {
    expect(checkSpec(spec)).toBeNull();
    expect(checkSpec({ swagger: '2.0' })).toMatch(/Swagger 2/);
    expect(checkSpec('texte')).not.toBeNull();
    expect(specInfo(spec)).toEqual({ title: 'API Paiements', version: '2.3' });
  });

  it('liste les opérations', () => {
    expect(listOperations(spec).map((o) => o.key)).toEqual(['POST /oauth/token', 'GET /paiements/{id}']);
    expect(listOperations(spec)[1]!.summary).toBe('lirePaiement');
  });

  it('normalise une opération: corps, références, réponses triées, exemples', () => {
    const op = operationFromSpec(spec, 'POST /oauth/token')!;
    expect(op.contentType).toBe('application/x-www-form-urlencoded');
    expect(op.requestBody).toEqual([
      { name: 'grant_type', type: '"client_credentials"', required: true, description: 'Toujours client_credentials.' },
      { name: 'client_id', type: 'string', required: true, description: 'Identifiant du service client.' },
      { name: 'scope', type: 'string', required: false, description: '' },
    ]);
    expect(op.responses.map((r) => [r.status, r.description])).toEqual([
      [200, 'Jeton émis'],
      [401, 'Client inconnu ou secret faux'],
    ]);
    expect(op.responses[0]!.example).toContain('"expires_in": 900');
  });

  it('fusionne les paramètres du chemin et de l’opération', () => {
    const op = operationFromSpec(spec, 'GET /paiements/{id}')!;
    expect(op.parameters?.map((p) => [p.name, p.in, p.type, p.required])).toEqual([
      ['id', 'path', 'string (uuid)', true],
      ['expand', 'query', 'array<string>', false],
    ]);
  });

  it('null pour une opération absente', () => {
    expect(operationFromSpec(spec, 'DELETE /oauth/token')).toBeNull();
    expect(operationFromSpec(spec, 'n’importe quoi')).toBeNull();
  });
});
