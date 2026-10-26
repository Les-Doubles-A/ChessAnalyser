// Préférences locales. Le stockage peut être indisponible (navigation privée,
// données bloquées) : l'application doit fonctionner sans.

const KEY = 'chessanalyser:v1';

export interface Prefs {
  lastUsername?: string;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { lastUsername } = parsed as Record<string, unknown>;
    return typeof lastUsername === 'string' ? { lastUsername } : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Stockage indisponible : rien n'est mémorisé.
  }
}
