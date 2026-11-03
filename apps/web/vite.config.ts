import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const proxy = {
  '/api': 'http://127.0.0.1:3001',
  '/collab': {
    target: 'ws://127.0.0.1:3002',
    ws: true,
    rewrite: (path: string) => path.replace(/^\/collab/, ''),
  },
};

// La CSP de deploy/Caddyfile; draw.io de dev tourne sur une autre origine.
const drawio = new URL(process.env.VITE_DRAWIO_URL ?? 'http://localhost:58081', 'http://localhost').origin;
const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' ${drawio}; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`;

// En dev, l'API et le serveur collab passent par le même origine que l'app:
// le cookie de session suit donc aussi le WebSocket.
// `vite preview` sert le build de production sous la CSP de production, pour la vérifier.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy },
  preview: {
    port: 4173,
    strictPort: true,
    // L'API n'accepte que l'origine de dev (anti-CSRF): le proxy de la préversion la présente.
    proxy: { ...proxy, '/api': { target: 'http://127.0.0.1:3001', headers: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' } } },
    headers: { 'Content-Security-Policy': csp },
  },
});
