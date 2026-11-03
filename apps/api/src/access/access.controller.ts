import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth, SessionOnly } from '../auth/auth.guard.js';
import { AccessService } from './access.service.js';

@SessionOnly()
@Controller()
export class AccessController {
  constructor(private readonly access: AccessService) {}

  /** Ajoute une personne ou un groupe au volume, ou change son rôle. */
  @Put('projects/:id/grants')
  @HttpCode(204)
  setGrant(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.access.setGrant(auth, id, body ?? {}, req.ip);
  }

  @Delete('projects/:id/grants/:type/:principalId')
  @HttpCode(204)
  removeGrant(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('type') type: string,
    @Param('principalId', ParseUUIDPipe) principalId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.access.removeGrant(auth, id, { type, id: principalId }, req.ip);
  }

  /** Remplace la liste d'une restriction (`view` ou `edit`); vide, elle lève la restriction. */
  @Put('pages/:id/restrictions/:kind')
  @HttpCode(204)
  setRestriction(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.access.setRestriction(auth, id, kind, body ?? {}, req.ip);
  }
}
