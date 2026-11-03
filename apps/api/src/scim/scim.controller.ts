import { type ArgumentsHost, Body, Catch, ConflictException, Controller, Delete, type ExceptionFilter, ForbiddenException, Get, Headers, HttpCode, HttpException, Inject, Param, Patch, Post, Put, Query, Req, Res, UseFilters } from '@nestjs/common';
import { canManageAccounts } from '@andal/authz';
import { newScimToken, type Database } from '@andal/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit.service.js';
import { type AuthContext, CurrentAuth, Public, SessionOnly } from '../auth/auth.guard.js';
import { config } from '../env.js';
import { DB } from '../infra.module.js';
import { SCIM_ERROR, ScimError, ScimService } from './scim.service.js';

/** Toute erreur part au format SCIM, que le fournisseur affiche telle quelle. */
@Catch()
class ScimExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const detail = exception instanceof HttpException ? exception.message : 'Erreur interne.';
    if (!(exception instanceof HttpException)) console.error('SCIM:', exception);
    void reply
      .status(status)
      .header('Content-Type', 'application/scim+json')
      .send({ schemas: [SCIM_ERROR], status: String(status), detail, ...(exception instanceof ScimError && exception.scimType ? { scimType: exception.scimType } : {}) });
  }
}

type Json = Record<string, unknown>;

/**
 * API SCIM 2.0 de l'espace, sous /api/scim/v2. Le jeton SCIM ouvre ces routes,
 * et elles seules: ni session, ni jeton d'API personnel.
 */
@Public()
@UseFilters(ScimExceptionFilter)
@Controller('scim/v2')
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  private async send(reply: FastifyReply, auth: string | undefined, run: (ctx: Awaited<ReturnType<ScimService['authenticate']>>) => Promise<unknown>, status = 200) {
    const ctx = await this.scim.authenticate(auth);
    const body = await run(ctx);
    reply.status(status).header('Content-Type', 'application/scim+json');
    return body;
  }

  @Get('ServiceProviderConfig')
  config(@Headers('authorization') auth: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, async () => this.scim.serviceProviderConfig());
  }

  @Get('ResourceTypes')
  resourceTypes(@Headers('authorization') auth: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, async () => this.scim.resourceTypes());
  }

  @Get('Schemas')
  schemas(@Headers('authorization') auth: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, async () => this.scim.schemas());
  }

  @Get('Users')
  listUsers(@Headers('authorization') auth: string | undefined, @Query() query: Json, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.listUsers(ctx, query));
  }

  @Get('Users/:id')
  getUser(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.getUser(ctx, id));
  }

  @Post('Users')
  createUser(@Headers('authorization') auth: string | undefined, @Body() body: Json | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.createUser(ctx, body ?? {}), 201);
  }

  @Put('Users/:id')
  replaceUser(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Body() body: Json | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.replaceUser(ctx, id, body ?? {}));
  }

  @Patch('Users/:id')
  patchUser(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Body() body: Json | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.patchUser(ctx, id, body ?? {}));
  }

  @Delete('Users/:id')
  @HttpCode(204)
  async deleteUser(@Headers('authorization') auth: string | undefined, @Param('id') id: string) {
    await this.scim.deleteUser(await this.scim.authenticate(auth), id);
  }

  @Get('Groups')
  listGroups(@Headers('authorization') auth: string | undefined, @Query() query: Json, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.listGroups(ctx, query));
  }

  @Get('Groups/:id')
  getGroup(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Query() query: Json, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.getGroup(ctx, id, query));
  }

  @Post('Groups')
  createGroup(@Headers('authorization') auth: string | undefined, @Body() body: Json | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.createGroup(ctx, body ?? {}), 201);
  }

  @Put('Groups/:id')
  replaceGroup(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Body() body: Json | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.replaceGroup(ctx, id, body ?? {}));
  }

  @Patch('Groups/:id')
  patchGroup(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Body() body: Json | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.send(reply, auth, (ctx) => this.scim.patchGroup(ctx, id, body ?? {}));
  }

  @Delete('Groups/:id')
  @HttpCode(204)
  async deleteGroup(@Headers('authorization') auth: string | undefined, @Param('id') id: string) {
    await this.scim.deleteGroup(await this.scim.authenticate(auth), id);
  }
}

/** Le jeton SCIM de l'espace, géré par ses admins: un seul actif, montré une fois. */
@SessionOnly()
@Controller('admin/scim')
export class ScimAdminController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  private assertAdmin(auth: AuthContext) {
    if (!canManageAccounts(auth.user.workspace_role)) throw new ForbiddenException("Réservé aux admins de l'espace.");
  }

  private async active(workspaceId: string) {
    return this.db.selectFrom('scim_tokens as t').leftJoin('users as u', 'u.id', 't.created_by').select(['t.id', 't.prefix', 't.created_at', 't.last_used_at', 'u.name as created_by']).where('t.workspace_id', '=', workspaceId).where('t.revoked_at', 'is', null).executeTakeFirst();
  }

  @Get()
  async status(@CurrentAuth() auth: AuthContext) {
    this.assertAdmin(auth);
    const token = await this.active(auth.user.workspace_id);
    const [users, groups] = await Promise.all([
      this.db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('n')).where('workspace_id', '=', auth.user.workspace_id).where('scim_external_id', 'is not', null).executeTakeFirstOrThrow(),
      this.db.selectFrom('groups').select((eb) => eb.fn.countAll<string>().as('n')).where('workspace_id', '=', auth.user.workspace_id).where('source', '=', 'scim').executeTakeFirstOrThrow(),
    ]);
    return {
      baseUrl: `${config.webOrigin}/api/scim/v2`,
      token: token ? { prefix: token.prefix, createdAt: token.created_at.toISOString(), createdBy: token.created_by, lastUsedAt: token.last_used_at?.toISOString() ?? null } : null,
      provisioned: { users: Number(users.n), groups: Number(groups.n) },
      sso: config.oidc ? { groupsClaim: config.oidc.groupsClaim } : null,
    };
  }

  /** Crée le jeton, ou le remplace: l'ancien cesse aussitôt de fonctionner. */
  @Post('token')
  async create(@CurrentAuth() auth: AuthContext, @Req() req: FastifyRequest) {
    this.assertAdmin(auth);
    const { token, hash, prefix } = newScimToken();
    const replaced = await this.db.transaction().execute(async (trx) => {
      const old = await trx.updateTable('scim_tokens').set({ revoked_at: new Date() }).where('workspace_id', '=', auth.user.workspace_id).where('revoked_at', 'is', null).returning('id').execute();
      await trx.insertInto('scim_tokens').values({ workspace_id: auth.user.workspace_id, token_hash: hash, prefix, created_by: auth.user.id }).execute();
      return old.length > 0;
    });
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: replaced ? 'scim.token_rotated' : 'scim.token_created', targetType: 'workspace', targetId: auth.user.workspace_id, ip: req.ip });
    return { token };
  }

  @Delete('token')
  @HttpCode(204)
  async revoke(@CurrentAuth() auth: AuthContext, @Req() req: FastifyRequest) {
    this.assertAdmin(auth);
    const revoked = await this.db.updateTable('scim_tokens').set({ revoked_at: new Date() }).where('workspace_id', '=', auth.user.workspace_id).where('revoked_at', 'is', null).returning('id').execute();
    if (revoked.length === 0) throw new ConflictException('Aucun jeton SCIM actif.');
    await this.audit.record({ workspaceId: auth.user.workspace_id, actorId: auth.user.id, action: 'scim.token_revoked', targetType: 'workspace', targetId: auth.user.workspace_id, ip: req.ip });
  }
}
