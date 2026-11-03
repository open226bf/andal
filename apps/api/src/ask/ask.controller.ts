import { Body, Controller, Get, Headers, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import { localeFromHeader, tr, translateMessage } from '@andal/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth, SessionOnly } from '../auth/auth.guard.js';
import { AskService } from './ask.service.js';
import { generate } from './providers.js';

@Controller()
export class AskController {
  constructor(private readonly ask: AskService) {}

  @Get('ask/status')
  status(@CurrentAuth() auth: AuthContext) {
    return this.ask.status(auth);
  }

  /**
   * `{ question, volume? }` → flux server-sent events: `sources` (les pages
   * citables), puis des `delta` de texte, puis `done` (ou `error`).
   */
  @Post('ask')
  async question(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const prepared = await this.ask.prepare(auth, body ?? {});
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // Pas de mise en tampon par un proxy: le texte arrive au fil de l'eau.
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Le flux ne passe pas par le filtre des erreurs: ses messages sont traduits ici.
    const locale = localeFromHeader(req.headers['accept-language']);
    send('sources', prepared.sources);
    try {
      const result = await generate(prepared.settings, prepared.system, prepared.user, (text) => send('delta', { text }), abort.signal);
      if (result.outcome === 'refusal') send('error', { message: tr(locale, 'Le modèle a décliné cette question. Reformulez-la, ou cherchez directement dans les pages citées.') });
      else send('done', { truncated: result.outcome === 'truncated' });
    } catch (error) {
      if (!abort.signal.aborted) {
        console.error('Assistant en échec:', error instanceof Error ? error.message : error);
        send('error', { message: tr(locale, 'Le modèle ne répond pas pour le moment. Réessayez dans un instant.') });
      }
    }
    reply.raw.end();
  }

  @SessionOnly()
  @Get('admin/ai')
  adminGet(@CurrentAuth() auth: AuthContext) {
    return this.ask.adminGet(auth);
  }

  /** `{ enabled, provider: "anthropic" | "openai", model, baseUrl?, apiKey? }`: apiKey null l'efface, absent la garde. */
  @SessionOnly()
  @Put('admin/ai')
  adminSave(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.ask.adminSave(auth, body ?? {}, req.ip);
  }

  @SessionOnly()
  @Post('admin/ai/test')
  @HttpCode(200)
  async adminTest(@CurrentAuth() auth: AuthContext, @Headers('accept-language') acceptLanguage: string | undefined) {
    const result = await this.ask.adminTest(auth);
    // L'erreur du modèle est renvoyée telle quelle (pas d'exception): traduite si elle vient d'Andal.
    return result.error === undefined ? result : { ...result, error: translateMessage(result.error, localeFromHeader(acceptLanguage)) };
  }
}
