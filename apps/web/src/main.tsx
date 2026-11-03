import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/literata/opsz.css';
import '@fontsource/atkinson-hyperlegible-mono/400.css';
import '@fontsource/atkinson-hyperlegible-mono/500.css';
import './styles/app.css';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './lib/api';
import { restoreTheme } from './lib/theme';
import { createAppRouter } from './router';

restoreTheme();

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // Session expirée ou révoquée en cours de route: retour à la connexion, puis à cette page.
    // La requête `me` est laissée au garde de route, qui fait déjà la redirection.
    onError: (error, query) => {
      if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== 'me' && router.state.location.pathname !== '/login') {
        const retour = router.state.location.href;
        queryClient.clear();
        void router.navigate({ to: '/login', search: { retour } });
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createAppRouter(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
