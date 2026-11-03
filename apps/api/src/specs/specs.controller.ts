import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { SpecsService } from './specs.service.js';

/** `?version=3`: une version précise; absent, la dernière. */
function sequence(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('version: un entier à partir de 1.');
  return n;
}

@Controller()
export class SpecsController {
  constructor(private readonly specs: SpecsService) {}

  @Get('projects/:id/specs')
  list(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.specs.list(auth.subject, auth.user.workspace_id, id);
  }

  /**
   * Publier depuis la CI:
   * `curl -X POST -H 'Authorization: Bearer andal_…' -H 'Content-Type: application/yaml' --data-binary @openapi.yaml '…/api/projects/<id>/specs?name=paiements'`
   */
  @Post('projects/:id/specs')
  publish(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query('name') name: string | undefined, @Req() req: FastifyRequest, @Body() body: unknown) {
    return this.specs.publish(auth, id, name ? String(name) : undefined, req, body, req.ip);
  }

  @Get('specs/:id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.specs.get(auth.subject, auth.user.workspace_id, id);
  }

  @Get('specs/:id/document')
  document(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query('version') version?: string) {
    return this.specs.document(auth.subject, auth.user.workspace_id, id, sequence(version));
  }

  @Get('specs/:id/operations')
  operations(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query('version') version?: string) {
    return this.specs.operations(auth.subject, auth.user.workspace_id, id, sequence(version));
  }

  /** `?key=POST /oauth/token`: l'opération telle que l'affiche le bloc OpenAPI d'une page. */
  @Get('specs/:id/operation')
  operation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query('key') key = '', @Query('version') version?: string) {
    return this.specs.operation(auth.subject, auth.user.workspace_id, id, String(key), sequence(version));
  }

  @Delete('specs/:id')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.specs.remove(auth, id, req.ip);
  }
}
