import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.notifications.list(auth);
  }

  /** `{ ids }` marque ces notifications comme lues; sans `ids`, toutes. */
  @Post('read')
  @HttpCode(204)
  read(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined) {
    return this.notifications.markRead(auth, body?.ids);
  }

  @Put('email')
  @HttpCode(204)
  email(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined) {
    return this.notifications.setEmail(auth, body?.enabled);
  }
}
