import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { AuthCard, FormError, FormOk } from '../components/AuthCard';
import { PasswordField } from '../components/PasswordField';
import { api, ApiError, localPath, useAuthConfig } from '../lib/api';

const SSO_ERRORS: Record<string, string> = {
  sso: 'La connexion par SSO a échoué. Réessayez.',
  'sso-compte': "Cette identité n'est liée à aucun compte Andal. Demandez un accès à un admin de votre espace.",
  'sso-desactive': 'Ce compte est désactivé. Contactez un admin de votre espace.',
  'sso-indisponible': 'Le fournisseur SSO ne répond pas pour le moment.',
};

const NOTICES: Record<string, string> = {
  'mot-de-passe-change': 'Mot de passe changé. Connectez-vous avec le nouveau.',
};

/** Connexion par identifiant et mot de passe, et par SSO quand le serveur le propose. */
export function LoginPage() {
  const config = useAuthConfig();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { retour, erreur, info } = useSearch({ from: '/login' });
  const returnTo = localPath(retour);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(erreur ? (SSO_ERRORS[erreur] ?? SSO_ERRORS.sso!) : null);
  const [pending, setPending] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const notice = info ? NOTICES[info] : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
      queryClient.clear();
      await router.navigate({ href: returnTo ?? '/' });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      // 403: compte désactivé, 429: trop d'essais; le message du serveur dit quoi faire.
      setError(status === 401 ? 'Identifiant ou mot de passe incorrect.' : (status === 403 || status === 429) && err instanceof ApiError ? err.message : 'Connexion impossible pour le moment. Réessayez dans un instant.');
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  const sso = config.data?.oidc;
  return (
    <AuthCard title="Connexion">
      {notice && !error && <FormOk>{notice}</FormOk>}
      {error && <FormError>{error}</FormError>}
      {config.data?.password && (
        <form className="login-form" onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="login-identifier">Email ou identifiant</label>
            <input
              id="login-identifier"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
          <PasswordField ref={passwordRef} label="Mot de passe" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {config.data.passwordReset && (
            <Link to="/mot-de-passe-oublie" className="form-link">
              Mot de passe oublié ?
            </Link>
          )}
          <button type="submit" className="btn-ink" disabled={pending}>
            {pending ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      )}
      {sso && (
        <>
          {config.data?.password && <p className="or">ou</p>}
          <a className="btn-line" href={`/api/auth/oidc?returnTo=${encodeURIComponent(returnTo ?? '/')}`}>
            Se connecter avec {sso.label}
          </a>
        </>
      )}
      {config.isError && <FormError>Le serveur ne répond pas. Vérifiez que l'API est lancée.</FormError>}
      <p className="login-foot">Pas encore de compte ? Demandez une invitation à un admin de votre espace.</p>
    </AuthCard>
  );
}
