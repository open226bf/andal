import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth, SessionOnly } from '../auth/auth.guard.js';
import { WebhooksService } from './webhooks.service.js';

@SessionOnly()
@Controller('admin/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.webhooks.list(auth);
  }

  /** `{ name, url, kind: "generic" | "slack" | "teams", events: [...], projectId? }` */
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.webhooks.create(auth, body ?? {}, req.ip);
  }

  @Patch(':id')
  @HttpCode(204)
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.webhooks.update(auth, id, body ?? {}, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.webhooks.remove(auth, id, req.ip);
  }

  @Post(':id/rotate')
  rotate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.webhooks.rotate(auth, id, req.ip);
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.test(auth, id);
  }

  @Get(':id/deliveries')
  deliveries(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.deliveries(auth, id);
  }
}
