import type { Category } from '../analysis/classify';

/** Symboles et libellés propres au projet (pas les glyphes de chess.com). */
export const CATEGORY: Record<Category, { label: string; symbol: string }> = {
  book: { label: 'Livre', symbol: 'L' },
  forced: { label: 'Forcé', symbol: '□' },
  best: { label: 'Meilleur', symbol: '!' },
  excellent: { label: 'Excellent', symbol: '' },
  good: { label: 'Bon', symbol: '' },
  inaccuracy: { label: 'Imprécision', symbol: '?!' },
  mistake: { label: 'Erreur', symbol: '?' },
  blunder: { label: 'Gaffe', symbol: '??' },
};

export const ARROW_COLOR = 'rgba(31, 111, 178, 0.85)';

export function formatAccuracy(value: number | null | undefined): string {
  if (value === null || value === undefined) return '…';
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
