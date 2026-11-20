import { useCallback, useEffect, useRef, useState } from 'react';
import { PRESET_DEPTH, runAnalysis, type Preset } from '../analysis/runAnalysis';
import type { ParsedGame } from '../chess/game';
import {
  EngineStartError,
  EngineTimeoutError,
  type Engine,
  type PositionEval,
} from '../engine/types';
import { createWorkerEngine } from '../engine/worker-engine';

let shared: Engine | undefined;

/** Un seul moteur pour toute la session ; recréé après une erreur fatale. */
export function getEngine(): Engine {
  shared ??= createWorkerEngine();
  return shared;
}

/**
 * Abandonne le moteur partagé s'il est hors service (plantage, démarrage raté, moteur figé),
 * pour que la demande suivante en crée un neuf. Sans effet si `engine` a déjà été remplacé.
 */
export function releaseFailedEngine(engine: Engine | undefined, error: unknown): void {
  const dead = error instanceof EngineStartError || error instanceof EngineTimeoutError;
  if (!dead || shared === undefined || (engine !== undefined && engine !== shared)) return;
  shared.terminate();
  shared = undefined;
}

export type AnalysisStatus = 'running' | 'done' | 'cancelled' | 'error';

export interface AnalysisState {
  status: AnalysisStatus;
  /** Préréglage de l'analyse en cours ou de la dernière lancée. */
  preset: Preset;
  /** Préréglage des évaluations affichées, null tant qu'aucune analyse n'est complète. */
  shownPreset: Preset | null;
  evals: (PositionEval | undefined)[];
  done: number;
  total: number;
  error?: string;
}

/** @param initialPreset Préréglage de la première analyse, lancée dès l'ouverture de la partie. */
export function useAnalysis(game: ParsedGame, initialPreset: Preset = 'standard') {
  const total = game.plies.length + 1;
  // Seule la valeur à l'ouverture compte : la changer ensuite ne relance pas l'analyse.
  const initialRef = useRef(initialPreset);
  const [state, setState] = useState<AnalysisState>(() => ({
    status: 'running',
    preset: initialPreset,
    shownPreset: null,
    evals: [],
    done: 0,
    total,
  }));
  const controllerRef = useRef<AbortController | undefined>(undefined);
  // Dernières évaluations complètes, conservées pendant une relance en profondeur.
  const completeRef = useRef<{ preset: Preset; evals: (PositionEval | undefined)[] } | null>(null);

  const start = useCallback(
    async (preset: Preset) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const keep = completeRef.current;
      const pending: (PositionEval | undefined)[] = [];
      setState({
        status: 'running',
        preset,
        shownPreset: keep?.preset ?? null,
        evals: keep?.evals ?? [],
        done: 0,
        total,
      });

      let engine: Engine | undefined;
      try {
        engine = getEngine();
        const result = await runAnalysis(game, engine, {
          depth: PRESET_DEPTH[preset],
          signal: controller.signal,
          onPosition: (index, evaluation) => {
            if (controller.signal.aborted) return;
            pending[index] = evaluation;
            const done = pending.filter(Boolean).length;
            setState((s) => ({ ...s, done, evals: keep ? s.evals : [...pending] }));
          },
        });
        if (controllerRef.current !== controller) return;
        if (result.complete) {
          completeRef.current = { preset, evals: result.evals };
          setState((s) => ({ ...s, status: 'done', shownPreset: preset, evals: result.evals }));
        } else {
          setState((s) => ({ ...s, status: 'cancelled' }));
        }
      } catch (error) {
        releaseFailedEngine(engine, error);
        if (controllerRef.current !== controller) return;
        console.error(error);
        setState((s) => ({
          ...s,
          status: 'error',
          error:
            error instanceof EngineStartError
              ? error.message
              : 'L’analyse a échoué. Les évaluations obtenues restent affichées.',
        }));
      }
    },
    [game, total],
  );

  useEffect(() => {
    completeRef.current = null;
    void start(initialRef.current);
    return () => controllerRef.current?.abort();
  }, [start]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  return { state, start, cancel };
}
