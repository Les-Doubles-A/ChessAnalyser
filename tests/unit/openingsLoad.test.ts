import { describe, expect, it, vi } from 'vitest';

describe('chargement de la base d’ouvertures', () => {
  it('un échec n’est pas mémorisé : l’appel suivant réessaie', async () => {
    vi.resetModules();
    let fail = true;
    vi.doMock('../../src/data/openings.json', () => {
      if (fail) throw new Error('réseau indisponible');
      return { default: { names: { 'x w - -': ['A00', 'Test'] }, book: [] } };
    });
    const { loadOpeningIndex } = await import('../../src/analysis/openings');

    await expect(loadOpeningIndex()).rejects.toThrow();
    fail = false;
    const index = await loadOpeningIndex();
    expect(index.nameOf('x w - - 0 1')).toEqual({ eco: 'A00', name: 'Test' });
    // Une fois chargée, la base est réutilisée.
    expect(loadOpeningIndex()).toBe(loadOpeningIndex());
    vi.doUnmock('../../src/data/openings.json');
  });
});
