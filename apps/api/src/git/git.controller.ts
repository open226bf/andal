import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth, Public, SessionOnly } from '../auth/auth.guard.js';
import { GitService } from './git.service.js';

@Controller()
export class GitController {
  constructor(private readonly git: GitService) {}

  @SessionOnly()
  @Get('projects/:id/git')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.git.get(auth, id);
  }

  /** `{ repoUrl, branch?, path?, token?, enabled? }`: token null efface le jeton, absent le garde. */
  @SessionOnly()
  @Put('projects/:id/git')
  save(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.git.save(auth, id, body ?? {}, req.ip);
  }

  @SessionOnly()
  @Delete('projects/:id/git')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.git.remove(auth, id, req.ip);
  }

  /** Synchroniser tout de suite (aussi permis à un jeton: la CI peut le demander après un merge). */
  @Post('projects/:id/git/sync')
  @HttpCode(202)
  sync(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.git.syncNow(auth, id);
  }

  /** Webhook « push » de GitHub, GitLab, Gitea ou Forgejo (Content-Type: application/json). */
  @Public()
  @Post('git/hooks/:id')
  @HttpCode(202)
  hook(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: Record<string, string | string[] | undefined>, @Req() req: RawBodyRequest<FastifyRequest>) {
    return this.git.hook(id, headers, req.rawBody);
  }
}
