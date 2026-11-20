import { useEffect, useState } from 'react';
import { terminalEval } from '../analysis/runAnalysis';
import { isAbortError, type Engine, type PositionEval } from '../engine/types';
import { getEngine, releaseFailedEngine } from './useAnalysis';

/** Les évaluations dépendent de la profondeur : une même position est mise en cache par profondeur. */
const cacheKey = (depth: number, fen: string) => `${depth} ${fen}`;

/**
 * Évalue à la demande les positions d'une variante avec le moteur partagé, la position
 * affichée d'abord. Les évaluations déjà connues (partie analysée, variantes précédentes)
 * sont réutilisées. Les demandes passent dans la file du moteur, entre deux positions de
 * l'analyse de la partie si elle est encore en cours.
 *
 * `known` doit avoir été calculé à la profondeur `depth` (évaluations de la partie affichée).
 */
export function useVariationEvals(
  fens: readonly string[],
  current: number,
  depth: number,
  known: ReadonlyMap<string, PositionEval>,
) {
  const [cache, setCache] = useState<ReadonlyMap<string, PositionEval>>(() => new Map());
  // L'erreur est rattachée à la demande qui l'a produite : elle disparaît quand la variante
  // ou la profondeur change, même si plus rien n'est à évaluer.
  const [error, setError] = useState<{ request: string; message: string }>();
  const key = fens.join('|');
  const request = `${depth}|${key}`;

  useEffect(() => {
    const ordered = [...fens.slice(current, current + 1), ...fens];
    const missing = [...new Set(ordered)].filter(
      (fen) => !known.has(fen) && !cache.has(cacheKey(depth, fen)),
    );
    if (missing.length === 0) return;
    const controller = new AbortController();
    void (async () => {
      let engine: Engine | undefined;
      try {
        for (const fen of missing) {
          let evaluation = terminalEval(fen);
          if (!evaluation) {
            engine = getEngine();
            evaluation = await engine.evaluate(fen, depth, controller.signal);
          }
          if (controller.signal.aborted) return;
          const done = evaluation;
          setCache((previous) => new Map(previous).set(cacheKey(depth, fen), done));
        }
        setError(undefined);
      } catch (failure) {
        releaseFailedEngine(engine, failure);
        if (isAbortError(failure) || controller.signal.aborted) return;
        console.error(failure);
        setError({ request: `${depth}|${key}`, message: 'La variante n’a pas pu être évaluée.' });
      }
    })();
    return () => controller.abort();
    // `key` résume `fens` ; `cache` et `known` ne doivent pas relancer les demandes en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, current, depth]);

  return {
    evals: fens.map((fen) => known.get(fen) ?? cache.get(cacheKey(depth, fen))),
    error: error?.request === request ? error.message : undefined,
  };
}
