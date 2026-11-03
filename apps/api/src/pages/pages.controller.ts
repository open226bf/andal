import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { PagesService } from './pages.service.js';
import { VersionsService } from './versions.service.js';

@Controller()
export class PagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly versions: VersionsService,
  ) {}

  /** `{ title, parentId }`: parentId absent ou nul, la page va au premier niveau du volume. */
  @Post('projects/:id/pages')
  create(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.pages.create(auth, id, body ?? {}, req.ip);
  }

  @Get('projects/:id/trash')
  trash(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.pages.trash(auth, id);
  }

  /** `{ title?, summary? }` */
  @Patch('pages/:id')
  @HttpCode(204)
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.pages.update(auth, id, body ?? {}, req.ip);
  }

  /** `{ parentId, beforeId }`: sous parentId (nul: premier niveau), avant beforeId (nul: à la fin). */
  @Post('pages/:id/move')
  @HttpCode(204)
  move(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.pages.move(auth, id, body ?? {}, req.ip);
  }

  @Delete('pages/:id')
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.pages.remove(auth, id, req.ip);
  }

  @Get('pages/:id/versions')
  history(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.versions.list(auth.subject, id);
  }

  @Get('pages/:id/versions/:version')
  version(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) version: number) {
    return this.versions.get(auth.subject, id, version);
  }

  @Post('pages/:id/versions/:version/restore')
  restoreVersion(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) version: number, @Req() req: FastifyRequest) {
    return this.versions.restore(auth, id, version, req.ip);
  }

  /** Suppression définitive d'une page à la corbeille (admins du volume). */
  @Delete('pages/:id/purge')
  @HttpCode(204)
  purge(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.pages.purge(auth, id, req.ip);
  }

  @Post('pages/:id/restore')
  @HttpCode(204)
  restore(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.pages.restore(auth, id, req.ip);
  }
}
