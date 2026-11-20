// Mêmes tests de bout en bout, mais sur le site construit (vite build + vite preview) :
// c'est la seule configuration où la CSP du build est active (vite.config.ts).
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const PORT = 5175;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180000,
  },
});
