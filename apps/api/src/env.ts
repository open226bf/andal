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
};

if (!config.databaseUrl) throw new Error('DATABASE_URL manquant (copier .env.example en .env).');
if (!config.passwordLogin && !config.oidc) throw new Error('Aucun mode de connexion: laissez AUTH_PASSWORD actif ou renseignez OIDC_ISSUER.');
if (config.oidc && production && !config.oidc.issuer.startsWith('https://')) throw new Error('OIDC_ISSUER doit être en HTTPS en production.');
