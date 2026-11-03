import { Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { FilesService } from './files.service.js';

/** En-tête Content-Disposition qui garde les accents (RFC 6266) avec un repli ASCII. */
function disposition(inline: boolean, name: string): string {
  const ascii = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'fichier';
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** multipart/form-data, un seul champ fichier. */
  @Post('pages/:id/files')
  upload(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.files.upload(auth, id, req, req.ip);
  }

  @Get('files/:id')
  async download(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
    const file = await this.files.open(auth.subject, id);
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Length', String(file.size))
      .header('Content-Disposition', disposition(file.inline, file.name))
      // Un fichier ne change jamais: un nouvel envoi a un nouvel identifiant.
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      // Ouvert directement (SVG, HTML déguisé…), il ne peut rien exécuter dans l'origine d'Andal.
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .send(file.stream);
  }
}
