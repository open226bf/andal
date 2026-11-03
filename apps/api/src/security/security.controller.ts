import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { canManageAccount, canManageAccounts } from '@andal/authz';
import { localeFromHeader, type Database } from '@andal/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { type AuthContext, CurrentAuth, SessionOnly } from '../auth/auth.guard.js';
import { MfaService } from '../auth/mfa.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { DB } from '../infra.module.js';

/** Sécurité de son propre compte: double authentification et sessions ouvertes. */
@SessionOnly()
@Controller('me')
export class SecurityController {
  constructor(
    private readonly mfa: MfaService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  @Get('mfa')
  status(@CurrentAuth() auth: AuthContext) {
    return this.mfa.status(auth.user);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  setup(@CurrentAuth() auth: AuthContext) {
    return this.mfa.setup(auth.user);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  enable(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest) {
    return this.mfa.enable(auth.user, body?.code, req.ip);
  }

  @Post('mfa/disable')
  @HttpCode(204)
  disable(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.mfa.disable(auth.user, body?.code, req, reply);
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  regenerate(@CurrentAuth() auth: AuthContext, @Body() body: Record<string, unknown> | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.mfa.regenerate(auth.user, body?.code, req, reply);
  }

  @Get('sessions')
  list(@CurrentAuth() auth: AuthContext, @Req() req: FastifyRequest) {
    // Un affichage: dans la langue de l'interface qui le demande.
    return this.sessions.list(auth.user, auth.sessionId, localeFromHeader(req.headers['accept-language']));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async close(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Req() req: FastifyRequest) {
    if (!/^[0-9a-f]{16}$/.test(id)) throw new BadRequestException('Session inconnue.');
    await this.sessions.revoke(auth.user, { id });
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'auth.session_closed', targetType: 'user', targetId: auth.user.id, ip: req.ip });
  }

  /** « Fermer toutes les autres »: seule la session de cette requête reste ouverte. */
  @Post('sessions/close-others')
  @HttpCode(200)
  async closeOthers(@CurrentAuth() auth: AuthContext, @Req() req: FastifyRequest) {
    const closed = await this.sessions.revoke(auth.user, { allExcept: auth.sessionId });
    if (closed) await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'auth.sessions_closed', targetType: 'user', targetId: auth.user.id, ip: req.ip, metadata: { closed } });
    return { closed };
  }
}

/** Ce que l'administration peut faire à la sécurité d'un compte. */
@SessionOnly()
@Controller('admin/accounts')
export class AdminSecurityController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly mfa: MfaService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/mfa/reset')
  @HttpCode(204)
  resetMfa(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.mfa.adminReset(auth.user, id, req.ip);
  }

  /** Ferme toutes les sessions d'un compte (appareil perdu, départ): il faudra se reconnecter partout. */
  @Post(':id/sessions/close')
  @HttpCode(200)
  async closeSessions(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    if (!canManageAccounts(auth.user.workspace_role)) throw new ForbiddenException("Réservé aux admins de l'espace.");
    const target = await this.db.selectFrom('users').selectAll().where('id', '=', id).where('workspace_id', '=', auth.user.workspace_id).executeTakeFirst();
    if (!target) throw new NotFoundException('Compte introuvable.');
    if (!canManageAccount({ userId: auth.user.id, role: auth.user.workspace_role }, { userId: target.id, role: target.workspace_role })) {
      throw new ForbiddenException(auth.user.id === target.id ? 'Fermez vos propres sessions depuis Mon compte.' : 'Seul un propriétaire peut modifier ce compte.');
    }
    const closed = await this.sessions.revoke(target, { allExcept: null });
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'account.sessions_closed', targetType: 'user', targetId: target.id, ip: req.ip, metadata: { closed } });
    return { closed };
  }
}
