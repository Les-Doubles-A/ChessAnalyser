import { describe, expect, it, vi } from 'vitest';
import { EngineStartError, EngineTimeoutError, type Engine } from '../../src/engine/types';
import { getEngine, releaseFailedEngine } from '../../src/ui/useAnalysis';

vi.mock('../../src/engine/worker-engine', () => ({
  createWorkerEngine: (): Engine => ({
    newGame: vi.fn(async () => undefined),
    evaluate: vi.fn(),
    terminate: vi.fn(),
  }),
}));

describe('moteur partagé', () => {
  it('n’est remplacé qu’après une panne du moteur, et seulement s’il est toujours le moteur courant', () => {
    const first = getEngine();
    expect(getEngine()).toBe(first);

    // Une erreur ordinaire ne condamne pas le moteur.
    releaseFailedEngine(first, new Error('Aucune évaluation reçue'));
    expect(getEngine()).toBe(first);

    // Moteur figé : arrêté puis recréé à la demande suivante.
    releaseFailedEngine(first, new EngineTimeoutError());
    expect(first.terminate).toHaveBeenCalledOnce();
    const second = getEngine();
    expect(second).not.toBe(first);

    // Une panne signalée pour l'ancien moteur ne touche pas le nouveau.
    releaseFailedEngine(first, new EngineStartError('plantage tardif'));
    expect(getEngine()).toBe(second);
    expect(second.terminate).not.toHaveBeenCalled();
  });
});
