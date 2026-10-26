import { outcomeFor, type GameSummary, type Outcome, type PlayerSide } from '../api/chesscom';

export const TIME_CLASS_LABELS: Record<GameSummary['timeClass'], string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapide',
  daily: 'Daily',
  unknown: 'Autre',
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  win: 'Victoire',
  loss: 'Défaite',
  draw: 'Nulle',
};

export interface Perspective {
  color: 'white' | 'black';
  me: PlayerSide;
  opponent: PlayerSide;
  outcome: Outcome;
}

/** Point de vue du joueur recherché ; blancs par défaut s'il ne figure pas dans la partie. */
export function perspective(game: GameSummary, username: string): Perspective {
  const isBlack = game.black.username.toLowerCase() === username.toLowerCase();
  const me = isBlack ? game.black : game.white;
  const opponent = isBlack ? game.white : game.black;
  return { color: isBlack ? 'black' : 'white', me, opponent, outcome: outcomeFor(me) };
}

export function formatDate(endTime: number): string {
  return new Date(endTime * 1000).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
