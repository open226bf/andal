import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { RayonsService } from './rayons.service.js';

/** Les rayons de la bibliothèque: lus par tous, rangés par les admins de l'espace. */
@Controller('rayons')
export class RayonsController {
  constructor(private readonly rayons: RayonsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.rayons.list(auth.user);
  }

  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.rayons.create(auth.user, body ?? {}, req.ip);
  }

  /** Corps: `{ ids: [...] }`, tous les rayons dans leur nouvel ordre. */
  @Put('order')
  @HttpCode(204)
  reorder(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.rayons.reorder(auth.user, body ?? {}, req.ip);
  }

  @Patch(':id')
  @HttpCode(204)
  rename(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.rayons.rename(auth.user, id, body ?? {}, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.rayons.remove(auth.user, id, req.ip);
  }
}
