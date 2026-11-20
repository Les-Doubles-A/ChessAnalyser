import type { Ref } from 'react';
import { PRESET_DEPTH, type Preset } from '../analysis/runAnalysis';

interface Props {
  ref: Ref<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  preset: Preset;
  onPresetChange: (preset: Preset) => void;
  error?: string;
  busy: boolean;
  onSubmit: (username: string) => void;
}

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: 'standard', label: `Standard (profondeur ${PRESET_DEPTH.standard}, rapide)` },
  { value: 'deep', label: `Profonde (profondeur ${PRESET_DEPTH.deep}, plus lente)` },
];

export function SearchForm({
  ref,
  value,
  onChange,
  preset,
  onPresetChange,
  error,
  busy,
  onSubmit,
}: Props) {
  return (
    <form
      className="search"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <label htmlFor="username">Pseudo chess.com</label>
      <div className="search-row">
        <input
          ref={ref}
          id="username"
          name="username"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="ex. : hikaru"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby="username-error"
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Recherche…' : 'Voir mes parties'}
        </button>
      </div>
      <p id="username-error" className="field-error" aria-live="polite">
        {error}
      </p>
      <label className="preset">
        Analyse
        <select value={preset} onChange={(event) => onPresetChange(event.target.value as Preset)}>
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
