import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Politique de sécurité du contenu (AC-X-2) : aucune ressource hors du site, seule
 * api.chess.com est interrogée. Les styles inline viennent de React (attributs `style`,
 * dont react-chessboard) ; 'wasm-unsafe-eval' permet de compiler Stockfish (WebAssembly).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self' https://api.chess.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Ajoute la CSP au build seulement : en développement, Vite et le rafraîchissement à chaud
 * de React injectent des scripts inline et un WebSocket que la politique bloquerait.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'chessanalyser-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
});
