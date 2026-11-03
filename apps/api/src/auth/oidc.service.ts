import { Inject, Injectable } from '@nestjs/common';
import { initialsOf, profileColor, suggestUsername, type Database, type User } from '@andal/db';
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import * as oidc from 'openid-client';
import { AuditService } from '../audit.service.js';
import { config } from '../env.js';
import { DB, VALKEY } from '../infra.module.js';

export const OIDC_FLOW_COOKIE = 'andal_oidc';
export const OIDC_FLOW_TTL_SECONDS = 600;

interface Flow {
  verifier: string;
  state: string;
  nonce: string;
  returnTo: string;
}

/**
 * SSO OpenID Connect, optionnel: code d'autorisation + PKCE, state et nonce.
 * L'état du parcours vit dans Valkey, le navigateur n'en garde qu'un identifiant.
 */
@Injectable()
export class OidcService {
  private configuration?: Promise<oidc.Configuration>;

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return config.oidc !== null;
  }

  private get redirectUri(): string {
    return `${config.webOrigin}/api/auth/callback`;
  }

  /** Découverte paresseuse: l'API démarre même si le fournisseur est éteint. */
  private client(): Promise<oidc.Configuration> {
    const settings = config.oidc;
    if (!settings) throw new Error('OIDC désactivé');
    this.configuration ??= oidc
      .discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret, undefined, settings.allowHttp ? { execute: [oidc.allowInsecureRequests] } : undefined)
      .catch((error: unknown) => {
        this.configuration = undefined;
        throw error;
      });
    return this.configuration;
  }

  private flowKey(flowId: string): string {
    return `oidc:${createHash('sha256').update(flowId).digest('hex')}`;
  }

  async start(returnTo: string): Promise<{ url: string; flowId: string }> {
    const client = await this.client();
    const flow: Flow = { verifier: oidc.randomPKCECodeVerifier(), state: oidc.randomState(), nonce: oidc.randomNonce(), returnTo };
    const flowId = randomBytes(32).toString('base64url');
    await this.valkey.set(this.flowKey(flowId), JSON.stringify(flow), 'EX', OIDC_FLOW_TTL_SECONDS);
    const url = oidc.buildAuthorizationUrl(client, {
      redirect_uri: this.redirectUri,
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
      code_challenge_method: 'S256',
      state: flow.state,
      nonce: flow.nonce,
    });
    return { url: url.href, flowId };
  }

  /** Échange le code, vérifie le jeton d'identité et retrouve le compte Andal. */
  async finish(flowId: string, callbackUrl: URL): Promise<{ user: User | null; idToken: string; returnTo: string }> {
    const raw = await this.valkey.getdel(this.flowKey(flowId));
    if (!raw) throw new Error('Parcours SSO expiré ou inconnu');
    const flow = JSON.parse(raw) as Flow;
    const client = await this.client();
    const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims || !tokens.id_token) throw new Error("Jeton d'identité absent");
    return { user: await this.resolveUser(claims), idToken: tokens.id_token, returnTo: flow.returnTo };
  }

  /**
   * 1. Identité déjà liée (émetteur + sujet).
   * 2. Sinon, compte existant avec le même email, si le fournisseur l'a vérifié: on lie.
   * 3. Sinon, création seulement si OIDC_AUTO_CREATE est actif.
   */
  private async resolveUser(claims: oidc.IDToken): Promise<User | null> {
    const linked = await this.db.selectFrom('users').selectAll().where('oidc_issuer', '=', claims.iss).where('oidc_subject', '=', claims.sub).executeTakeFirst();
    if (linked) return linked;

    const email = typeof claims.email === 'string' && claims.email_verified === true ? claims.email.toLowerCase() : null;
    if (!email) return null;

    const existing = await this.db
      .selectFrom('users')
      .selectAll()
      .where(sql`lower(email)`, '=', email)
      .where('oidc_subject', 'is', null)
      .executeTakeFirst();
    if (existing) {
      const user = await this.db
        .updateTable('users')
        .set({ oidc_issuer: claims.iss, oidc_subject: claims.sub })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.oidc_linked', targetType: 'user', targetId: user.id, metadata: { issuer: claims.iss } });
      return user;
    }

    if (!config.oidc?.autoCreate) return null;
    const workspace = await this.db.selectFrom('workspaces').select('id').orderBy('created_at').executeTakeFirst();
    if (!workspace) return null;
    const name = (typeof claims.name === 'string' && claims.name.trim()) || email.split('@')[0]!;
    const count = Number((await this.db.selectFrom('users').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
    const user = await this.db
      .insertInto('users')
      .values({
        workspace_id: workspace.id,
        email,
        // Un identifiant, pour pouvoir être cité (@identifiant) dans les commentaires.
        username: await this.freeUsername(workspace.id, suggestUsername(email)),
        name,
        initials: initialsOf(name),
        color: profileColor(count),
        // Un nouveau venu ne voit rien tant qu'un admin ne lui ouvre pas de volume.
        workspace_role: 'member',
        oidc_issuer: claims.iss,
        oidc_subject: claims.sub,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({ workspaceId: user.workspace_id, actorId: user.id, action: 'auth.oidc_provisioned', targetType: 'user', targetId: user.id, metadata: { issuer: claims.iss } });
    return user;
  }

  /** « lea », sinon « lea-2 », « lea-3 »…: le premier identifiant libre de l'espace. */
  private async freeUsername(workspaceId: string, base: string): Promise<string> {
    const stem = (base.length >= 2 ? base : `compte${base}`).slice(0, 36);
    const taken = await this.db
      .selectFrom('users')
      .select(sql<string>`lower(username)`.as('u'))
      .where('workspace_id', '=', workspaceId)
      .where(sql<string>`lower(username)`, 'like', `${stem.replace(/[%_\\]/g, '\\$&')}%`)
      .execute();
    const used = new Set(taken.map((t) => t.u));
    if (!used.has(stem)) return stem;
    for (let i = 2; ; i += 1) if (!used.has(`${stem}-${i}`)) return `${stem}-${i}`;
  }

  /** Adresse de déconnexion chez le fournisseur, pour fermer aussi la session SSO, puis revenir sur `after`. */
  async logoutUrl(idToken: string | undefined, after = '/login'): Promise<string | null> {
    if (!this.enabled || !idToken) return null;
    try {
      const client = await this.client();
      if (!client.serverMetadata().end_session_endpoint) return null;
      return oidc.buildEndSessionUrl(client, { id_token_hint: idToken, post_logout_redirect_uri: `${config.webOrigin}${after}` }).href;
    } catch {
      return null;
    }
  }
}
