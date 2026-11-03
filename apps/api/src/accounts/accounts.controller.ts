import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type AuthContext, CurrentAuth, Public } from '../auth/auth.guard.js';
import { LoginThrottleService } from '../auth/login-throttle.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { AccountsService } from './accounts.service.js';

/** Administration des comptes: réservée aux propriétaires et admins de l'espace (vérifié par le service). */
@Controller('admin')
export class AdminAccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('accounts')
  overview(@CurrentAuth() auth: AuthContext) {
    return this.accounts.overview(auth.user);
  }

  @Post('invitations')
  invite(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.accounts.invite(auth.user, body ?? {}, req.ip);
  }

  @Post('invitations/:id/resend')
  resend(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.accounts.resendInvitation(auth.user, id, req.ip);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  revoke(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.accounts.revokeInvitation(auth.user, id, req.ip);
  }

  @Patch('accounts/:id')
  @HttpCode(204)
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.accounts.setRole(auth.user, id, body?.role, req.ip);
  }

  @Post('accounts/:id/disable')
  @HttpCode(204)
  disable(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.accounts.setDisabled(auth.user, id, true, req.ip);
  }

  @Post('accounts/:id/enable')
  @HttpCode(204)
  enable(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.accounts.setDisabled(auth.user, id, false, req.ip);
  }

  @Post('accounts/:id/reset-password')
  reset(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.accounts.adminReset(auth.user, id, req.ip);
  }
}

/** Liens reçus par email: invitation et réinitialisation. Sans session, par nature. */
@Controller('auth')
export class AccountLinksController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
    private readonly throttle: LoginThrottleService,
  ) {}

  @Public()
  @Get('links/:token')
  describe(@Param('token') token: string) {
    return this.accounts.describeLink(token);
  }

  /** Crée le compte et ouvre la session dans la foulée (sauf en SSO seul: il faut passer par le fournisseur). */
  @Public()
  @Post('invitations/accept')
  async accept(@Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const user = await this.accounts.acceptInvitation(body?.token, body ?? {}, req.ip);
    if (user.password_hash) await this.sessions.open(user, 'password', req, reply);
    return { signedIn: user.password_hash !== null };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    const user = await this.accounts.resetPassword(body?.token, body?.password, req.ip);
    // Un nouveau mot de passe lève le blocage dû aux échecs passés.
    await this.throttle.succeeded(user.email);
    if (user.username) await this.throttle.succeeded(user.username);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const email = typeof body?.email === 'string' ? body.email.slice(0, 254) : '';
    await this.throttle.guard(`forgot:${email.trim().toLowerCase()}`, req.ip, reply);
    // Chaque demande compte: au-delà du seuil, plus d'email pendant la fenêtre.
    await this.throttle.failed(`forgot:${email.trim().toLowerCase()}`, req.ip);
    await this.accounts.forgotPassword(email, req.ip);
  }
}
