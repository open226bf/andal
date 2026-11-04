import { Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { ImportsService } from './imports.service.js';

@Controller()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** multipart/form-data: `parentId` (facultatif), puis le fichier (.zip, .md, .html). Répond tout de suite; le worker importe. */
  @Post('projects/:id/imports')
  start(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.imports.start(auth, id, req, req.ip);
  }

  @Get('imports/:id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.get(auth, id);
  }
}
