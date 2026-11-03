import { ArrowsClockwiseIcon, IdentificationCardIcon, PlugsConnectedIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormError } from '../components/AuthCard';
import { CopyField } from '../components/CopyField';
import { ConfirmDialog, Modal, type Confirmation } from '../components/Dialog';
import { api, errorMessage, useScim } from '../lib/api';
import { relative } from '../lib/format';
import { t, tn, tx } from '../lib/i18n';

/**
 * L'annuaire de l'entreprise branché sur Andal: SCIM pour créer, mettre à jour
 * et retirer les comptes et les groupes depuis le fournisseur d'identité
 * (Okta, Entra ID, Keycloak, authentik…), et les groupes du SSO à la connexion.
 */
export function DirectorySection() {
  const scim = useScim();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'scim'] });

  const create = async () => {
    setError(null);
    try {
      const created = await api<{ token: string }>('/admin/scim/token', { method: 'POST' });
      setToken(created.token);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (scim.isPending) return <div className="doc-skeleton" aria-busy="true" aria-label={t('Chargement de l’annuaire')}><span /><span /></div>;
  if (scim.isError) return <FormError>{errorMessage(scim.error, t('Impossible de lire l’annuaire.'))}</FormError>;
  const state = scim.data;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1 className="doc-title">{t('Annuaire')}</h1>
          <p className="admin-count">{t('Les comptes et les groupes viennent du fournisseur d’identité de l’entreprise: une arrivée, un départ, un changement d’équipe s’y font une fois, et Andal suit.')}</p>
        </div>
      </div>
      {error && <FormError>{error}</FormError>}

      <section className="directory-card" aria-labelledby="scim-title">
        <header>
          <span className="grp" aria-hidden>
            <IdentificationCardIcon size={20} />
          </span>
          <div>
            <h2 id="scim-title">{t('Provisionnement SCIM')}</h2>
            <p className="muted">
              {state.token
                ? t('Actif · {accounts} et {groups} tenus par l’annuaire', {
                    accounts: tn(state.provisioned.users, '{n} compte', '{n} comptes'),
                    groups: tn(state.provisioned.groups, '{n} groupe', '{n} groupes'),
                  })
                : t('Inactif: aucun jeton')}
            </p>
          </div>
        </header>
        <p className="dialog-text">
          {t('Dans votre fournisseur d’identité, ajoutez une application SCIM 2.0 avec cette adresse et le jeton ci-dessous (authentification « Bearer »). Les comptes créés entrent comme membres, sans volume; les groupes poussés s’ouvrent aux volumes comme les autres, mais leurs membres ne se gèrent que dans l’annuaire.')}
        </p>
        <CopyField label={t('Adresse de base SCIM')} value={state.baseUrl} />
        {state.token ? (
          <p className="scim-token">
            <PlugsConnectedIcon size={18} aria-hidden />
            <span>
              {state.token.createdBy
                ? tx('Jeton {prefix} créé {when} par {name}', { prefix: <code>{state.token.prefix}…</code>, when: relative(state.token.createdAt), name: state.token.createdBy })
                : tx('Jeton {prefix} créé {when}', { prefix: <code>{state.token.prefix}…</code>, when: relative(state.token.createdAt) })}
              {' · '}
              {state.token.lastUsedAt ? t('dernier appel {when}', { when: relative(state.token.lastUsedAt) }) : t('jamais utilisé')}
            </span>
          </p>
        ) : null}
        <div className="dialog-actions git-actions">
          {state.token && (
            <button
              type="button"
              className="ghost danger"
              onClick={() =>
                setConfirm({
                  title: t('Révoquer le jeton SCIM ?'),
                  body: t('Le fournisseur d’identité ne pourra plus rien créer ni modifier. Les comptes et groupes déjà provisionnés restent tels quels.'),
                  action: t('Révoquer'),
                  run: async () => {
                    await api('/admin/scim/token', { method: 'DELETE' });
                    await refresh();
                  },
                })
              }
            >
              {t('Révoquer')}
            </button>
          )}
          <button
            type="button"
            className={state.token ? 'btn-line' : 'btn-ink'}
            onClick={() =>
              state.token
                ? setConfirm({
                    title: t('Remplacer le jeton SCIM ?'),
                    body: t('L’ancien jeton cesse aussitôt de fonctionner: collez le nouveau dans le fournisseur d’identité dans la foulée.'),
                    action: t('Remplacer'),
                    run: create,
                  })
                : void create()
            }
          >
            {state.token ? <ArrowsClockwiseIcon size={18} aria-hidden /> : <IdentificationCardIcon size={18} aria-hidden />}
            {state.token ? t('Remplacer le jeton') : t('Créer le jeton SCIM')}
          </button>
        </div>
      </section>

      <section className="directory-card" aria-labelledby="sso-groups-title">
        <header>
          <span className="grp" aria-hidden>
            <UsersThreeIcon size={20} />
          </span>
          <div>
            <h2 id="sso-groups-title">{t('Groupes du SSO')}</h2>
            <p className="muted">{!state.sso ? t('SSO non configuré sur ce serveur') : state.sso.groupsClaim ? t('Actifs · claim « {claim} »', { claim: state.sso.groupsClaim }) : t('Inactifs')}</p>
          </div>
        </header>
        <p className="dialog-text">
          {state.sso?.groupsClaim
            ? t('À chaque connexion par SSO, la personne entre dans les groupes que nomme son jeton d’identité et sort des autres groupes SSO. Un groupe nommé pour la première fois est créé: ouvrez-lui des volumes depuis le panneau Partager.')
            : t('Sans SCIM, les groupes peuvent suivre le jeton d’identité: renseignez OIDC_GROUPS_CLAIM (souvent « groups ») sur le serveur, et OIDC_GROUPS_SCOPE si votre fournisseur demande un scope pour l’envoyer (Okta: « groups »).')}
        </p>
      </section>

      <Modal open={token !== null} onOpenChange={(open) => !open && setToken(null)} title={t('Votre jeton SCIM')}>
        <div className="dialog-body">
          <p className="token-once" role="note">
            <WarningIcon size={18} aria-hidden />
            {t('Copiez-le maintenant dans le fournisseur d’identité: il ne sera plus jamais affiché.')}
          </p>
          {token && <CopyField label={t('Jeton SCIM')} value={token} />}
          <div className="dialog-actions">
            <Dialog.Close className="btn-ink">{t('J’ai copié le jeton')}</Dialog.Close>
          </div>
        </div>
      </Modal>
      <ConfirmDialog confirmation={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
