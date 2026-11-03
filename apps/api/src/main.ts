import 'reflect-metadata';
import { config } from './env.js';
import { I18nExceptionFilter } from './i18n.filter.js';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { localeFromHeader, tr } from '@andal/db';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: config.trustProxy, bodyLimit: 1_048_576 }), { rawBody: true });
// Le cast absorbe l'écart de types entre la copie de fastify de Nest et la nôtre.
await app.register(fastifyCookie as unknown as Parameters<NestFastifyApplication['register']>[0]);
// Envoi de fichiers: un seul fichier par requête, taille plafonnée (UPLOAD_MAX_MB).
await app.register(fastifyMultipart as unknown as Parameters<NestFastifyApplication['register']>[0], { limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 4 } });

const fastify = app.getHttpAdapter().getInstance();

// Specs OpenAPI publiées en YAML brut (`--data-binary @openapi.yaml`); le JSON passe par l'analyseur par défaut.
fastify.addContentTypeParser(['application/yaml', 'application/x-yaml', 'text/yaml'], { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));
// Contenu de page en Markdown brut (`PUT /api/pages/:id/content`).
// SCIM envoie du JSON sous son propre type.
fastify.addContentTypeParser('application/scim+json', { parseAs: 'string', bodyLimit: 1_048_576 }, (_req, body, done) => {
  try {
    done(null, body === '' ? {} : JSON.parse(body as string));
  } catch {
    done(Object.assign(new Error('JSON invalide'), { statusCode: 400 }), undefined);
  }
});
fastify.addContentTypeParser(['text/markdown', 'text/x-markdown'], { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));

// Anti-CSRF: une requête qui modifie l'état et vient d'une autre origine est refusée.
// Les navigateurs envoient toujours Origin sur un POST; les clients hors navigateur n'en ont pas besoin.
fastify.addHook('onRequest', async (req, reply) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const origin = req.headers.origin;
  if (origin && origin !== config.webOrigin) {
    // Réponse envoyée avant Nest: le filtre des erreurs ne la voit pas, d'où la traduction ici.
    return reply.code(403).send({ statusCode: 403, message: tr(localeFromHeader(req.headers['accept-language']), 'Origine refusée') });
  }
});

// En-têtes de sécurité de base; la CSP stricte est servie avec l'application web.
fastify.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
  if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
});

app.setGlobalPrefix('api');
// Erreurs dans la langue du client (Accept-Language); les routes SCIM gardent leur format propre.
app.useGlobalFilters(new I18nExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
app.enableShutdownHooks();
await app.listen(config.port, config.host);
const methods = [config.passwordLogin && 'mot de passe', config.oidc && `SSO ${config.oidc.label}`].filter(Boolean).join(' + ');
console.log(`API Andal sur http://127.0.0.1:${config.port}/api (connexion: ${methods})`);
