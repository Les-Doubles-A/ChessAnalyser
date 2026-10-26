import { defineConfig } from 'vitest/config';

// Tests d'intégration avec le vrai Stockfish (Node), plus lents que les tests unitaires.
export default defineConfig({
  test: {
    include: ['tests/engine/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
});
