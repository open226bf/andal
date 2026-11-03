import { storageConfigFromEnv } from '@andal/db';

// Charge le .env racine en développement; en production, l'environnement est fourni.
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // Pas de .env: on garde l'environnement du processus.
}

const production = process.env.NODE_ENV === 'production';

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} manquant.`);
  return value;
}

function int(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Proxys dont l'API croit l'en-tête X-Forwarded-For (syntaxe de proxy-addr):
 * par défaut la machine et les réseaux privés, où vit le Caddy du compose.
 * Sans cela, n'importe qui pourrait se donner l'adresse IP de son choix et
 * contourner les freins par adresse.
 */
function trustProxyFromEnv(): boolean | number | string {
  const value = process.env.TRUST_PROXY?.trim();
  if (!value) return 'loopback,uniquelocal';
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

const issuer = process.env.OIDC_ISSUER?.trim();

export const config = {
  port: Number(process.env.API_PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? '',
  valkeyUrl: process.env.VALKEY_URL ?? 'redis://127.0.0.1:56379',
  /** Adresse publique de l'interface: origine autorisée et base des redirections SSO. */
  webOrigin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, ''),
  secureCookies: production,
  /** Connexion par identifiant et mot de passe (comptes locaux). Activée par défaut. */
  passwordLogin: flag('AUTH_PASSWORD', true),
  /** SSO OpenID Connect (Keycloak, Authentik, Entra ID…). Désactivé tant que OIDC_ISSUER est vide. */
  oidc: issuer
    ? {
        issuer,
        clientId: required('OIDC_CLIENT_ID'),
        clientSecret: process.env.OIDC_CLIENT_SECRET?.trim() || undefined,
        label: process.env.OIDC_LABEL?.trim() || 'SSO',
        /** Crée un compte à la première connexion d'une identité inconnue. Sinon, seuls les comptes existants peuvent entrer. */
        autoCreate: flag('OIDC_AUTO_CREATE', false),
        /** Claim qui porte les groupes de la personne (« groups »): ses groupes Andal SSO suivent à chaque connexion. Vide: pas de synchro. */
        groupsClaim: process.env.OIDC_GROUPS_CLAIM?.trim() || null,
        /** Scope à demander en plus pour recevoir ce claim (Okta: « groups »). */
        groupsScope: process.env.OIDC_GROUPS_SCOPE?.trim() || null,
        /** HTTP n'est toléré qu'en développement (Keycloak local). */
        allowHttp: !production && issuer.startsWith('http://'),
      }
    : null,
  /** Envoi des emails. Sans SMTP_URL, les liens d'invitation et de réinitialisation sont remis à l'admin. */
  mail: process.env.SMTP_URL?.trim()
    ? { url: process.env.SMTP_URL.trim(), from: process.env.MAIL_FROM?.trim() || 'Andal <andal@localhost>' }
    : null,
  /**
   * Délai avant l'email d'une notification. S'il a été lu dans l'interface
   * entre-temps, rien ne part; sinon, un seul email regroupe tout ce qui attend.
   */
  notifyEmailDelaySeconds: Math.max(0, Number(process.env.NOTIFY_EMAIL_DELAY ?? 300)),
  /** Jours passés à la corbeille avant suppression définitive par le worker. */
  trashRetentionDays: Math.max(1, Number(process.env.TRASH_RETENTION_DAYS ?? 30)),
  /** Stockage S3 des fichiers envoyés; null: envoi désactivé. */
  storage: storageConfigFromEnv(),
  /** Taille maximale d'un fichier envoyé, en octets. */
  uploadMaxBytes: Math.max(1, Number(process.env.UPLOAD_MAX_MB ?? 25)) * 1024 * 1024,
  trustProxy: trustProxyFromEnv(),
  /**
   * Limite de débit par minute: lectures et écritures d'une session, d'un jeton
   * d'API ou du jeton SCIM; requêtes sans session, par adresse IP.
   * RATE_LIMIT=false la coupe (une passerelle en amont s'en charge déjà).
   */
  rateLimit: flag('RATE_LIMIT', true) ? { reads: int('RATE_LIMIT_READS', 600), writes: int('RATE_LIMIT_WRITES', 120), anonymous: int('RATE_LIMIT_ANONYMOUS', 120) } : null,
  /** Adresse d'écoute: 127.0.0.1 en dev, 0.0.0.0 dans un conteneur. */
  host: process.env.HOST?.trim() || '127.0.0.1',
  /** Webhooks vers le réseau interne (Mattermost sur le LAN, tests): désactivé par défaut, contre le SSRF. */
  webhookAllowPrivate: process.env.WEBHOOK_ALLOW_PRIVATE === 'true',
  /**
   * Assistant de questions-réponses, si les admins ne l'ont pas réglé dans
   * l'interface: AI_PROVIDER=anthropic (Claude) ou openai (API compatible, locale comprise).
   */
  ai: aiFromEnv(),
  /** Synchro Git depuis le réseau interne ou en file:// (forge interne, tests). Désactivé par défaut. */
  gitAllowLocal: process.env.GIT_ALLOW_LOCAL === 'true',
  /** Aperçu des liens GitHub: sans jeton, seulement les dépôts publics (60 requêtes/heure). */
  githubToken: process.env.GITHUB_TOKEN?.trim() || null,
  /** Aperçu des liens Jira (Cloud ou Data Center): les trois variables, ou rien. */
  jira:
    process.env.JIRA_BASE_URL?.trim() && process.env.JIRA_EMAIL?.trim() && process.env.JIRA_API_TOKEN?.trim()
      ? { baseUrl: process.env.JIRA_BASE_URL.trim().replace(/\/+$/, ''), email: process.env.JIRA_EMAIL.trim(), token: process.env.JIRA_API_TOKEN.trim() }
      : null,
};

if (!config.databaseUrl) throw new Error('DATABASE_URL manquant (copier .env.example en .env).');
if (!config.passwordLogin && !config.oidc) throw new Error('Aucun mode de connexion: laissez AUTH_PASSWORD actif ou renseignez OIDC_ISSUER.');
if (config.oidc && production && !config.oidc.issuer.startsWith('https://')) throw new Error('OIDC_ISSUER doit être en HTTPS en production.');

function aiFromEnv(): { provider: 'anthropic' | 'openai'; model: string; baseUrl: string | null; apiKey: string | null } | null {
  const provider = process.env.AI_PROVIDER?.trim();
  if (provider !== 'anthropic' && provider !== 'openai') return null;
  return {
    provider,
    model: process.env.AI_MODEL?.trim() || (provider === 'anthropic' ? 'claude-opus-5-5' : 'llama3.1'),
    baseUrl: process.env.AI_BASE_URL?.trim() || null,
    apiKey: process.env.AI_API_KEY?.trim() || null,
  };
}
