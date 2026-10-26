/** Score du point de vue des blancs. `mate: 0` désigne une position déjà matée. */
export type Score = { cp: number } | { mate: number; winner: 'w' | 'b' };

export interface PositionEval {
  fen: string;
  /** 0 pour une position finale évaluée sans moteur. */
  depth: number;
  score: Score;
  bestMoveUci?: string;
  pv: string[];
}

export interface Engine {
  /** Prépare le moteur pour une nouvelle partie (vide la table de hachage). */
  newGame(): Promise<void>;
  evaluate(fen: string, depth: number, signal?: AbortSignal): Promise<PositionEval>;
  terminate(): void;
}

export class EngineStartError extends Error {
  constructor(cause?: unknown) {
    super('Le moteur d’analyse n’a pas pu démarrer dans ce navigateur.', { cause });
    this.name = 'EngineStartError';
  }
}

export function abortError(): DOMException {
  return new DOMException('Analyse annulée', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
