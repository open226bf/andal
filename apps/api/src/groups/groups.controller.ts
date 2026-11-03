import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { GroupsService } from './groups.service.js';

/** Groupes de l'espace: réservés aux propriétaires et admins (vérifié par le service). */
@Controller('admin/groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  overview(@CurrentAuth() auth: AuthContext) {
    return this.groups.overview(auth.user);
  }

  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.groups.create(auth.user, body ?? {}, req.ip);
  }

  @Patch(':id')
  @HttpCode(204)
  rename(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.groups.rename(auth.user, id, body ?? {}, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.groups.remove(auth.user, id, req.ip);
  }

  @Put(':id/members/:userId')
  @HttpCode(204)
  addMember(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: FastifyRequest) {
    return this.groups.addMember(auth.user, id, userId, req.ip);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: FastifyRequest) {
    return this.groups.removeMember(auth.user, id, userId, req.ip);
  }
}
