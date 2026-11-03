import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { CommentsService } from './comments.service.js';

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('pages/:id/comments')
  list(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.comments.list(auth.subject, id);
  }

  @Get('pages/:id/mentionable')
  mentionable(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.comments.mentionable(auth.subject, id);
  }

  @Post('pages/:id/threads')
  create(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, never> | undefined, @Req() req: FastifyRequest) {
    return this.comments.create(auth, id, body ?? {}, req.ip);
  }

  @Post('threads/:id/comments')
  reply(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.comments.reply(auth, id, body ?? {}, req.ip);
  }

  @Post('threads/:id/resolve')
  @HttpCode(204)
  resolve(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.comments.setResolved(auth, id, true, req.ip);
  }

  @Post('threads/:id/reopen')
  @HttpCode(204)
  reopen(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.comments.setResolved(auth, id, false, req.ip);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.comments.remove(auth, id, req.ip);
  }
}
