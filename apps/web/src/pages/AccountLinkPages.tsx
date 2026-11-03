import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthCard, FormError, FormOk } from '../components/AuthCard';
import { PasswordField } from '../components/PasswordField';
import { api, ApiError, errorMessage, useAuthConfig, useLinkInfo } from '../lib/api';
import { roleLabel } from '../lib/format';
import { t, tn, tx } from '../lib/i18n';

/** Même seuil que l'API (packages/db/src/password.ts): le serveur reste juge. */
const MIN_LENGTH = 12;
const PASSWORD_HINT = t("Au moins {min} caractères, sans votre email ni votre identifiant. Une phrase de passe fait très bien l'affaire.", { min: MIN_LENGTH });

function DeadLink({ kind }: { kind: 'invite' | 'reset' }) {
  return (
    <>
      <FormError>{t("Ce lien n'est plus valable : il a déjà servi, ou il a expiré.")}</FormError>
      <p className="login-foot">
        {kind === 'invite' ? t('Demandez une nouvelle invitation à un admin de votre espace.') : t('Demandez un nouveau lien depuis l’écran de connexion, ou à un admin.')}
      </p>
      <Link to="/login" className="btn-line">
        {t('Aller à la connexion')}
      </Link>
    </>
  );
}

/** Accepter une invitation: choisir son nom, son identifiant et son mot de passe. */
export function InvitationPage({ token }: { token: string }) {
  const info = useLinkInfo(token);
  const config = useAuthConfig();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createdForSso, setCreatedForSso] = useState(false);

  if (info.isPending) return <AuthCard title={t('Invitation')} />;
  if (info.isError || info.data.kind !== 'invite') {
    return (
      <AuthCard title={t('Invitation')}>
        <DeadLink kind="invite" />
      </AuthCard>
    );
  }
  const link = info.data;
  const nameValue = name ?? link.name ?? '';
  const usernameValue = username ?? link.suggestedUsername;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (link.passwordLogin && password.length < MIN_LENGTH) return setError(t('Le mot de passe doit faire au moins {min} caractères.', { min: MIN_LENGTH }));
    if (link.passwordLogin && password !== confirm) return setError(t('Les deux saisies du mot de passe diffèrent.'));
    setPending(true);
    setError(null);
    try {
      const { signedIn } = await api<{ signedIn: boolean }>('/auth/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token, name: nameValue, username: usernameValue, password: link.passwordLogin ? password : undefined }),
      });
      queryClient.clear();
      if (signedIn) await router.navigate({ to: '/' });
      else setCreatedForSso(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 410 ? t('Ce lien n’est plus valable.') : errorMessage(err, t('La création du compte a échoué. Réessayez dans un instant.')));
    } finally {
      setPending(false);
    }
  };

  if (createdForSso) {
    return (
      <AuthCard title={t('Bienvenue sur {workspace}', { workspace: link.workspace })}>
        <FormOk>{t('Votre compte est prêt. Connectez-vous avec votre compte d’entreprise.')}</FormOk>
        {config.data?.oidc && (
          <a className="btn-ink" href="/api/auth/oidc?returnTo=%2F">
            {t('Se connecter avec {provider}', { provider: config.data.oidc.label })}
          </a>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('Rejoindre {workspace}', { workspace: link.workspace })} documentTitle={t('Invitation')}>
      <p className="login-lede">
        {tx('Invitation pour {email}.', { email: <b>{link.email}</b> })}{' '}
        {link.groups.length > 0
          ? tn(link.groups.length, 'Votre compte aura le rôle {role}, et rejoindra le groupe {groups}.', 'Votre compte aura le rôle {role}, et rejoindra les groupes {groups}.', {
              role: roleLabel(link.role ?? 'member'),
              groups: link.groups.join(', '),
            })
          : t('Votre compte aura le rôle {role}.', { role: roleLabel(link.role ?? 'member') })}
      </p>
      {error && <FormError>{error}</FormError>}
      <form className="login-form" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="invite-name">{t('Votre nom')}</label>
          <input id="invite-name" className="input" autoComplete="name" required autoFocus maxLength={80} value={nameValue} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-username">{t('Identifiant de connexion')}</label>
          <input
            id="invite-username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            pattern="[a-z0-9._\-]{2,40}"
            value={usernameValue}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            aria-describedby="invite-username-hint"
          />
          <p className="form-hint" id="invite-username-hint">
            {t('Lettres minuscules, chiffres, point, tiret. Vous pourrez aussi vous connecter avec votre email.')}
          </p>
        </div>
        {link.passwordLogin && (
          <>
            <PasswordField label={t('Mot de passe')} hint={PASSWORD_HINT} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordField label={t('Confirmez le mot de passe')} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </>
        )}
        <button type="submit" className="btn-ink" disabled={pending}>
          {pending ? t('Création…') : t('Créer mon compte')}
        </button>
      </form>
    </AuthCard>
  );
}

/** Réinitialisation: le lien reçu par email (ou transmis par un admin) permet de choisir un nouveau mot de passe. */
export function ResetPasswordPage({ token }: { token: string }) {
  const info = useLinkInfo(token);
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (info.isPending) return <AuthCard title={t('Nouveau mot de passe')} />;
  if (info.isError || info.data.kind !== 'reset') {
    return (
      <AuthCard title={t('Nouveau mot de passe')}>
        <DeadLink kind="reset" />
      </AuthCard>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_LENGTH) return setError(t('Le mot de passe doit faire au moins {min} caractères.', { min: MIN_LENGTH }));
    if (password !== confirm) return setError(t('Les deux saisies diffèrent.'));
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      await router.navigate({ to: '/login', search: { info: 'mot-de-passe-change' } });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 410 ? t('Ce lien n’est plus valable.') : errorMessage(err, t('Le changement a échoué. Réessayez dans un instant.')));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard title={t('Nouveau mot de passe')}>
      <p className="login-lede">{tx('Pour le compte {email}. Vos sessions ouvertes seront fermées.', { email: <b>{info.data.email}</b> })}</p>
      {error && <FormError>{error}</FormError>}
      <form className="login-form" onSubmit={(e) => void submit(e)}>
        <PasswordField label={t('Nouveau mot de passe')} hint={PASSWORD_HINT} autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordField label={t('Confirmez le mot de passe')} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button type="submit" className="btn-ink" disabled={pending}>
          {pending ? t('Enregistrement…') : t('Enregistrer le mot de passe')}
        </button>
      </form>
    </AuthCard>
  );
}

/** Mot de passe oublié: la réponse est la même que le compte existe ou non. */
export function ForgotPasswordPage() {
  const config = useAuthConfig();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (config.data && !config.data.passwordReset) {
    return (
      <AuthCard title={t('Mot de passe oublié')}>
        <p className="login-lede">{t('Ce serveur n’envoie pas d’email. Demandez à un admin de votre espace de réinitialiser votre mot de passe.')}</p>
        <Link to="/login" className="btn-line">
          {t('Retour à la connexion')}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('Mot de passe oublié')}>
      {sent ? (
        <>
          <FormOk>{t('Si un compte existe pour {email}, un lien vient d’y être envoyé. Il expire dans une heure.', { email })}</FormOk>
          <Link to="/login" className="btn-line">
            {t('Retour à la connexion')}
          </Link>
        </>
      ) : (
        <>
          <p className="login-lede">{t('Indiquez l’email de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.')}</p>
          {error && <FormError>{error}</FormError>}
          <form className="login-form" onSubmit={(e) => void submit(e)}>
            <div className="field">
              <label htmlFor="forgot-email">{t('Email')}</label>
              <input id="forgot-email" className="input" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="submit" className="btn-ink" disabled={pending}>
              {pending ? t('Envoi…') : t('Recevoir un lien')}
            </button>
          </form>
          <Link to="/login" className="form-link">
            {t('Retour à la connexion')}
          </Link>
        </>
      )}
    </AuthCard>
  );
}
