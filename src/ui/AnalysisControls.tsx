import { PRESET_DEPTH, type Preset } from '../analysis/runAnalysis';
import type { AnalysisState } from './useAnalysis';

interface Props {
  state: AnalysisState;
  onCancel: () => void;
  onStart: (preset: Preset) => void;
}

const PRESET_LABEL: Record<Preset, string> = { standard: 'Standard', deep: 'profonde' };

export function AnalysisControls({ state, onCancel, onStart }: Props) {
  const { status, preset, shownPreset, done, total } = state;

  if (status === 'running') {
    return (
      <div className="analysis-controls">
        <p className="status" aria-live="polite">
          Analyse {preset === 'deep' ? 'profonde ' : ''}: {done} / {total} positions
        </p>
        <progress max={total} value={done} aria-label="Progression de l’analyse" />
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="analysis-controls">
        <p className="status error" role="alert">
          {state.error}
        </p>
        <button type="button" onClick={() => onStart(preset)}>
          Réessayer
        </button>
      </div>
    );
  }

  const deepAvailable = shownPreset !== 'deep';
  return (
    <div className="analysis-controls">
      <p className="status" aria-live="polite">
        {status === 'cancelled' && shownPreset
          ? `Analyse ${PRESET_LABEL[preset]} annulée ; résultats ${PRESET_LABEL[shownPreset]} conservés.`
          : status === 'cancelled'
            ? 'Analyse incomplète.'
            : `Analyse terminée (${PRESET_LABEL[shownPreset ?? preset]}, profondeur ${PRESET_DEPTH[shownPreset ?? preset]}).`}
      </p>
      {status === 'cancelled' && !shownPreset && (
        <button type="button" onClick={() => onStart('standard')}>
          Relancer l’analyse
        </button>
      )}
      {deepAvailable && (shownPreset || status === 'done') && (
        <button type="button" onClick={() => onStart('deep')}>
          Analyse profonde
        </button>
      )}
    </div>
  );
}
