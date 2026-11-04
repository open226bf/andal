import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { disposition } from '../files/files.controller.js';
import { ExportsService } from './exports.service.js';

@Controller()
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  /** `?format=markdown` (défaut) ou `pdf`: le fichier à télécharger. */
  @Get('pages/:id/export')
  async page(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query('format') format: string | undefined, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    if (format === 'pdf') {
      const file = await this.exports.pagePdf(auth, id, req.ip);
      return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', disposition(false, file.name)).header('Cache-Control', 'no-store').send(file.body);
    }
    if (format !== undefined && format !== 'markdown') throw new BadRequestException('Format inconnu: « markdown » ou « pdf ».');
    const file = await this.exports.pageMarkdown(auth, id);
    return reply.header('Content-Type', 'text/markdown; charset=utf-8').header('Content-Disposition', disposition(false, file.name)).header('Cache-Control', 'no-store').send(file.body);
  }

  /** Le volume en archive Markdown (.zip), pages lisibles seulement. */
  @Get('projects/:id/export')
  async volume(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const file = await this.exports.volumeZip(auth, id, req.ip);
    return reply.header('Content-Type', 'application/zip').header('Content-Disposition', disposition(false, file.name)).header('Cache-Control', 'no-store').send(file.stream);
  }
}
