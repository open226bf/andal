import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { AuthCard, FormError, FormOk } from '../components/AuthCard';
import { PasswordField } from '../components/PasswordField';
import { CodeField } from './SecuritySections';
import { api, ApiError, localPath, useAuthConfig } from '../lib/api';
import { t } from '../lib/i18n';

const SSO_ERRORS: Record<string, string> = {
  sso: t('La connexion par SSO a échoué. Réessayez.'),
  'sso-compte': t("Cette identité n'est liée à aucun compte Andal. Demandez un accès à un admin de votre espace."),
  'sso-desactive': t('Ce compte est désactivé. Contactez un admin de votre espace.'),
  'sso-indisponible': t('Le fournisseur SSO ne répond pas pour le moment.'),
};

const NOTICES: Record<string, string> = {
  'mot-de-passe-change': t('Mot de passe changé. Connectez-vous avec le nouveau.'),
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
  // Deuxième étape, pour un compte à double authentification.
  const [mfa, setMfa] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');

  const enter = async (recoveryCodesLeft?: number | null) => {
    queryClient.clear();
    // Presque plus de codes de secours: direction Mon compte pour en refaire.
    await router.navigate({ href: recoveryCodesLeft !== null && recoveryCodesLeft !== undefined && recoveryCodesLeft <= 3 ? '/compte' : (returnTo ?? '/') });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<{ mfa?: boolean }>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
      if (result.mfa) {
        setMfa(true);
        setPassword('');
        return;
      }
      await enter();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      // 403: compte désactivé, 429: trop d'essais; le message du serveur dit quoi faire.
      setError(status === 401 ? t('Identifiant ou mot de passe incorrect.') : (status === 403 || status === 429) && err instanceof ApiError ? err.message : t('Connexion impossible pour le moment. Réessayez dans un instant.'));
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<{ recoveryCodesLeft: number | null }>('/auth/login/mfa', { method: 'POST', body: JSON.stringify({ code }) });
      await enter(result.recoveryCodesLeft);
    } catch (err) {
      const message = err instanceof ApiError && err.status < 500 ? err.message : t('Connexion impossible pour le moment. Réessayez dans un instant.');
      setCode('');
      // Étape expirée ou trop d'essais: retour au mot de passe.
      if (err instanceof ApiError && err.status === 401 && /mot de passe|password/i.test(message)) {
        setMfa(false);
        setRecovery(false);
      }
      setError(message);
    } finally {
      setPending(false);
    }
  };

  if (mfa) {
    return (
      <AuthCard title={t('Code de vérification')}>
        {error && <FormError>{error}</FormError>}
        <form className="login-form" onSubmit={(e) => void submitCode(e)}>
          <p className="login-lead">{recovery ? t('Tapez un de vos codes de secours. Chacun ne sert qu’une fois.') : t('Ouvrez votre application d’authentification et tapez le code à 6 chiffres affiché pour Andal.')}</p>
          <CodeField key={recovery ? 'recovery' : 'totp'} id="login-code" label={recovery ? t('Code de secours') : t('Code à 6 chiffres')} value={code} onChange={setCode} recovery={recovery} />
          <button type="submit" className="btn-ink" disabled={pending}>
            {pending ? t('Vérification…') : t('Vérifier')}
          </button>
          <button
            type="button"
            className="form-link as-button"
            onClick={() => {
              setRecovery((r) => !r);
              setCode('');
              setError(null);
            }}
          >
            {recovery ? t('Utiliser l’application') : t('Plus de téléphone ? Utiliser un code de secours')}
          </button>
        </form>
        <p className="login-foot">{t('Plus de téléphone ni de code de secours ? Un admin de votre espace peut lever la double authentification de votre compte.')}</p>
      </AuthCard>
    );
  }

  const sso = config.data?.oidc;
  return (
    <AuthCard title={t('Connexion')}>
      {notice && !error && <FormOk>{notice}</FormOk>}
      {error && <FormError>{error}</FormError>}
      {config.data?.password && (
        <form className="login-form" onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="login-identifier">{t('Email ou identifiant')}</label>
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
          <PasswordField ref={passwordRef} label={t('Mot de passe')} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {config.data.passwordReset && (
            <Link to="/mot-de-passe-oublie" className="form-link">
              {t('Mot de passe oublié ?')}
            </Link>
          )}
          <button type="submit" className="btn-ink" disabled={pending}>
            {pending ? t('Connexion…') : t('Se connecter')}
          </button>
        </form>
      )}
      {sso && (
        <>
          {config.data?.password && <p className="or">{t('ou')}</p>}
          <a className="btn-line" href={`/api/auth/oidc?returnTo=${encodeURIComponent(returnTo ?? '/')}`}>
            {t('Se connecter avec {provider}', { provider: sso.label })}
          </a>
        </>
      )}
      {config.isError && <FormError>{t("Le serveur ne répond pas. Vérifiez que l'API est lancée.")}</FormError>}
      <p className="login-foot">{t('Pas encore de compte ? Demandez une invitation à un admin de votre espace.')}</p>
    </AuthCard>
  );
}
