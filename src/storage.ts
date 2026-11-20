// Préférences locales. Le stockage peut être indisponible (navigation privée,
// données bloquées) : l'application doit fonctionner sans.
import type { Preset } from './analysis/runAnalysis';

const KEY = 'chessanalyser:v1';
const PRESETS: readonly string[] = ['standard', 'deep'];

export interface Prefs {
  lastUsername?: string;
  /** Préréglage de la première analyse d'une partie (F3, écran E1). */
  preset?: Preset;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { lastUsername, preset } = parsed as Record<string, unknown>;
    return {
      ...(typeof lastUsername === 'string' ? { lastUsername } : {}),
      ...(typeof preset === 'string' && PRESETS.includes(preset)
        ? { preset: preset as Preset }
        : {}),
    };
  } catch {
    return {};
  }
}

/** Met à jour les préférences données et conserve les autres. */
export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...prefs }));
  } catch {
    // Stockage indisponible : rien n'est mémorisé.
  }
}
