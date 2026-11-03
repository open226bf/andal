import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { ProjectsService } from './projects.service.js';

/** Gestion des volumes; la lecture (étagère, sommaire) reste dans DocsController. */
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('projects')
  create(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.projects.create(auth, body ?? {}, req.ip);
  }

  @Get('projects/archived')
  archived(@CurrentAuth() auth: AuthContext) {
    return this.projects.archived(auth);
  }

  @Patch('projects/:id')
  @HttpCode(204)
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.projects.update(auth, id, body ?? {}, req.ip);
  }

  @Post('projects/:id/archive')
  @HttpCode(204)
  archive(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.projects.archive(auth, id, req.ip);
  }

  @Post('projects/:id/unarchive')
  @HttpCode(204)
  unarchive(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.projects.unarchive(auth, id, req.ip);
  }

  @Put('projects/:id/pin')
  @HttpCode(204)
  pin(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.pin(auth, id, true);
  }

  @Delete('projects/:id/pin')
  @HttpCode(204)
  unpin(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.pin(auth, id, false);
  }

  /** Corps: `{ confirm: "<nom court du volume>" }`. */
  @Delete('projects/:id')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.projects.remove(auth, id, body ?? {}, req.ip);
  }
}
