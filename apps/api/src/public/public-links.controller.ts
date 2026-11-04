import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth, Public, SessionOnly } from '../auth/auth.guard.js';
import { disposition } from '../files/files.controller.js';
import { PublicLinksService } from './public-links.service.js';

/** Gérer les liens publics: comme le reste du partage, depuis une session seulement. */
@Controller()
export class PublicLinksController {
  constructor(private readonly links: PublicLinksService) {}

  @Get('pages/:id/public-links')
  status(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.links.status(auth, id);
  }

  /** `{ pageId, subpages }` ou `{ projectId }`. */
  @Post('public-links')
  @SessionOnly()
  create(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.links.create(auth, body ?? {}, req.ip);
  }

  @Delete('public-links/:id')
  @SessionOnly()
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.links.remove(auth, id, req.ip);
  }
}

/** Lire un partage sans compte. Pas d'indexation par les moteurs de recherche. */
@Controller('public')
export class PublicController {
  constructor(private readonly links: PublicLinksService) {}

  @Public()
  @Get(':token')
  tree(@Param('token') token: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store');
    return this.links.tree(token);
  }

  @Public()
  @Get(':token/pages/:pageId')
  page(@Param('token') token: string, @Param('pageId', ParseUUIDPipe) pageId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store');
    return this.links.page(token, pageId);
  }

  @Public()
  @Get(':token/files/:fileId')
  async file(@Param('token') token: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() reply: FastifyReply) {
    const file = await this.links.file(token, fileId);
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Length', String(file.size))
      .header('Content-Disposition', disposition(file.inline, file.name))
      // Le lien peut être retiré à tout moment: pas de cache partagé.
      .header('Cache-Control', 'private, max-age=300')
      .header('X-Robots-Tag', 'noindex, nofollow')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .send(file.stream);
  }
}
