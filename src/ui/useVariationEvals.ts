import { useEffect, useState } from 'react';
import { terminalEval } from '../analysis/runAnalysis';
import { isAbortError, type PositionEval } from '../engine/types';
import { getEngine } from './useAnalysis';

/**
 * Évalue à la demande les positions d'une variante avec le moteur partagé, la position
 * affichée d'abord. Les évaluations déjà connues (partie analysée, variantes précédentes)
 * sont réutilisées. Les demandes passent dans la file du moteur, entre deux positions de
 * l'analyse de la partie si elle est encore en cours.
 */
export function useVariationEvals(
  fens: readonly string[],
  current: number,
  depth: number,
  known: ReadonlyMap<string, PositionEval>,
) {
  const [cache, setCache] = useState<ReadonlyMap<string, PositionEval>>(() => new Map());
  const [error, setError] = useState<string>();
  const key = fens.join('|');

  useEffect(() => {
    const ordered = [...fens.slice(current, current + 1), ...fens];
    const missing = [...new Set(ordered)].filter((fen) => !known.has(fen) && !cache.has(fen));
    if (missing.length === 0) return;
    const controller = new AbortController();
    void (async () => {
      try {
        for (const fen of missing) {
          const evaluation =
            terminalEval(fen) ?? (await getEngine().evaluate(fen, depth, controller.signal));
          if (controller.signal.aborted) return;
          setCache((previous) => new Map(previous).set(fen, evaluation));
        }
        setError(undefined);
      } catch (failure) {
        if (isAbortError(failure) || controller.signal.aborted) return;
        console.error(failure);
        setError('La variante n’a pas pu être évaluée.');
      }
    })();
    return () => controller.abort();
    // `key` résume `fens` ; `cache` et `known` ne doivent pas relancer les demandes en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, current, depth]);

  return { evals: fens.map((fen) => known.get(fen) ?? cache.get(fen)), error };
}
