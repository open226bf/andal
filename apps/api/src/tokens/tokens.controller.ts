import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth, SessionOnly } from '../auth/auth.guard.js';
import { TokensService } from './tokens.service.js';

/** Ses propres jetons d'API, depuis le navigateur seulement: un jeton n'en fabrique pas d'autres. */
@SessionOnly()
@Controller('me/tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.tokens.list(auth);
  }

  /** Corps: `{ name, scope: "read" | "write", expiresInDays?: 7 | 30 | 90 | 365 }`. Le jeton n'est renvoyé qu'ici. */
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.tokens.create(auth, body ?? {}, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.tokens.revoke(auth, id, req.ip);
  }
}
