// Mesures de T12 (durée d'analyse avec le vrai moteur) sur le site construit. Une seule
// mesure à la fois pour ne pas fausser les durées ; rien n'est simulé côté moteur.
import { defineConfig, devices } from '@playwright/test';

const PORT = 5176;

export default defineConfig({
  testDir: 'tests/perf',
  workers: 1,
  fullyParallel: false,
  timeout: 25 * 60000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180000,
  },
});
