import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { ApiError, api, type Me, type PagePreview, type Tree } from './lib/api';
import { ForgotPasswordPage, InvitationPage, ResetPasswordPage } from './pages/AccountLinkPages';
import { AdminPage } from './pages/AdminPage';
import { DocPage } from './pages/DocPage';
import { EmptyVolumePage } from './pages/EmptyVolumePage';
import { LoginPage } from './pages/LoginPage';
import { LibraryPage } from './pages/LibraryPage';
import { MissingPage } from './pages/MissingPage';

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // `retour`: la page à rouvrir après connexion; `erreur`: le motif d'un échec SSO.
  // `info`: un message à afficher (mot de passe changé).
  validateSearch: (search: Record<string, unknown>): { retour?: string; erreur?: string; info?: string } => ({
    retour: typeof search.retour === 'string' ? search.retour : undefined,
    erreur: typeof search.erreur === 'string' ? search.erreur : undefined,
    info: typeof search.info === 'string' ? search.info : undefined,
  }),
  beforeLoad: async () => {
    // Déjà connecté: inutile de montrer le formulaire. Hors cache, pour ne pas déclencher la redirection sur 401.
    const response = await fetch('/api/me', { credentials: 'same-origin' }).catch(() => null);
    if (response?.ok) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

/* Liens reçus par email: ils fonctionnent sans session. */
const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitation/$token',
  component: function Invitation() {
    const { token } = invitationRoute.useParams();
    return <InvitationPage token={token} />;
  },
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reinitialiser/$token',
  component: function Reset() {
    const { token } = resetRoute.useParams();
    return <ResetPasswordPage token={token} />;
  },
});

const forgotRoute = createRoute({ getParentRoute: () => rootRoute, path: '/mot-de-passe-oublie', component: ForgotPasswordPage });

/** Tout ce qui suit demande une session: sinon, direction la connexion. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData({ queryKey: ['me'], queryFn: () => api<Me>('/me') });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw redirect({ to: '/login', search: { retour: location.pathname === '/' ? undefined : location.href } });
      throw error;
    }
  },
  component: Outlet,
});

// L'accueil est la bibliothèque: tous les volumes, quel qu'en soit le nombre.
const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: LibraryPage });

const volumeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/v/$slug',
  beforeLoad: async ({ context, params }) => {
    const tree = await context.queryClient.ensureQueryData({ queryKey: ['tree', params.slug], queryFn: () => api<Tree>(`/projects/${params.slug}/tree`) });
    const first = tree.pages[0];
    if (first) throw redirect({ to: '/v/$slug/$pageId', params: { slug: params.slug, pageId: first.id } });
  },
  component: function VolumeRoute() {
    const { slug } = volumeRoute.useParams();
    return <EmptyVolumePage slug={slug} />;
  },
});

const pageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/v/$slug/$pageId',
  // `fil`: le fil de commentaires à montrer en arrivant (lien d'une notification).
  // `edition`: ouvrir directement en mode Modifier (page qu'on vient de créer).
  validateSearch: (search: Record<string, unknown>): { fil?: string; edition?: boolean } => ({
    fil: typeof search.fil === 'string' && /^[0-9a-f-]{36}$/.test(search.fil) ? search.fil : undefined,
    edition: search.edition === true || search.edition === 'true' ? true : undefined,
  }),
  component: function PageRoute() {
    const { slug, pageId } = pageRoute.useParams();
    const { fil, edition } = pageRoute.useSearch();
    return <DocPage slug={slug} pageId={pageId} thread={fil} edition={edition} />;
  },
});

/** Adresse stable d'une page, utilisée par les liens de l'éditeur: elle suit la page où qu'elle soit. */
const pageLinkRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/p/$pageId',
  beforeLoad: async ({ context, params }) => {
    let preview: PagePreview;
    try {
      preview = await context.queryClient.fetchQuery({ queryKey: ['preview', params.pageId], queryFn: () => api<PagePreview>(`/pages/${params.pageId}/preview`) });
    } catch {
      return; // Illisible ou inexistante: la route affiche un message, sans rien révéler de plus.
    }
    throw redirect({ to: '/v/$slug/$pageId', params: { slug: preview.project.slug, pageId: preview.id }, replace: true });
  },
  component: MissingPage,
});

const adminRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin', component: () => <AdminPage section="comptes" /> });
const groupsRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin/groupes', component: () => <AdminPage section="groupes" /> });

const routeTree = rootRoute.addChildren([
  loginRoute,
  invitationRoute,
  resetRoute,
  forgotRoute,
  appRoute.addChildren([homeRoute, volumeRoute, pageRoute, pageLinkRoute, adminRoute, groupsRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
