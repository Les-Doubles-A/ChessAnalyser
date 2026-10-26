// Réponses chess.com fictives, au format observé sur l'API publique le 2026-10-24.
// Pseudos inventés ; parties historiques du domaine public ou construites à la main.

export const USERNAME = 'testeur';
export const ARCHIVES_URL = `https://api.chess.com/pub/player/${USERNAME}/games/archives`;
export const MONTH_URLS = [
  `https://api.chess.com/pub/player/${USERNAME}/games/2026/09`,
  `https://api.chess.com/pub/player/${USERNAME}/games/2026/10`,
];

/** Construit un PGN au format chess.com, horloges comprises. */
export function pgnFrom(headers: Record<string, string>, sanMoves: string[]): string {
  const head = Object.entries(headers)
    .map(([key, value]) => `[${key} "${value}"]`)
    .join('\n');
  const parts = sanMoves.map((san, i) => {
    const number = Math.floor(i / 2) + 1;
    const prefix = i % 2 === 0 ? `${number}.` : `${number}...`;
    const seconds = 300 - i;
    const clock = `0:0${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return `${prefix} ${san} {[%clk ${clock}]}`;
  });
  return `${head}\n\n${parts.join(' ')} ${headers.Result}\n`;
}

export const OPERA_MOVES = (
  'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 ' +
  'Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'
).split(' ');

export const FOOLS_MATE_MOVES = ['f3', 'e5', 'g4', 'Qh4#'];

export const REPETITION_MOVES = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];

const baseHeaders = { Event: 'Live Chess', Site: 'Chess.com', Round: '-' };

export const OPERA_PGN = pgnFrom(
  {
    ...baseHeaders,
    Date: '2026.10.20',
    White: 'morphy_fan',
    Black: 'Testeur',
    Result: '1-0',
    WhiteElo: '1650',
    BlackElo: '1580',
    TimeControl: '600',
  },
  OPERA_MOVES,
);

export const FOOLS_MATE_PGN = pgnFrom(
  {
    ...baseHeaders,
    Date: '2026.10.18',
    White: 'pressé',
    Black: 'Testeur',
    Result: '0-1',
    WhiteElo: '820',
    BlackElo: '1575',
    TimeControl: '180',
  },
  FOOLS_MATE_MOVES,
);

export const REPETITION_PGN = pgnFrom(
  {
    ...baseHeaders,
    Date: '2026.10.15',
    White: 'Testeur',
    Black: 'prudent',
    Result: '1/2-1/2',
    WhiteElo: '1570',
    BlackElo: '1560',
    TimeControl: '60',
  },
  REPETITION_MOVES,
);

export const CORRUPT_PGN = '[Event "Live Chess"]\n[Result "1-0"]\n\n1. e4 e5 2. Qxf7 Kxf7 1-0\n';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export const OCTOBER_GAMES = {
  games: [
    {
      url: 'https://www.chess.com/game/live/1000000001',
      pgn: REPETITION_PGN,
      time_control: '60',
      end_time: at('2026-10-15T18:00:00Z'),
      rated: true,
      time_class: 'bullet',
      rules: 'chess',
      white: { rating: 1570, result: 'repetition', username: 'Testeur' },
      black: { rating: 1560, result: 'repetition', username: 'prudent' },
    },
    {
      url: 'https://www.chess.com/game/live/1000000003',
      pgn: OPERA_PGN,
      time_control: '600',
      end_time: at('2026-10-20T20:30:00Z'),
      rated: true,
      time_class: 'rapid',
      rules: 'chess',
      white: { rating: 1650, result: 'win', username: 'morphy_fan' },
      black: { rating: 1580, result: 'checkmated', username: 'Testeur' },
    },
    {
      url: 'https://www.chess.com/game/live/1000000002',
      pgn: FOOLS_MATE_PGN,
      time_control: '180',
      end_time: at('2026-10-18T09:00:00Z'),
      rated: true,
      time_class: 'blitz',
      rules: 'chess',
      white: { rating: 820, result: 'checkmated', username: 'pressé' },
      black: { rating: 1575, result: 'win', username: 'Testeur' },
    },
    {
      url: 'https://www.chess.com/game/live/1000000004',
      pgn: pgnFrom(
        {
          ...baseHeaders,
          Date: '2026.10.10',
          White: 'Testeur',
          Black: 'fischer960',
          Result: '0-1',
        },
        ['e4'],
      ),
      time_control: '180',
      end_time: at('2026-10-10T12:00:00Z'),
      rated: true,
      time_class: 'blitz',
      rules: 'chess960',
      white: { rating: 1500, result: 'resigned', username: 'Testeur' },
      black: { rating: 1490, result: 'win', username: 'fischer960' },
    },
    {
      url: 'https://www.chess.com/game/live/1000000005',
      time_class: 'blitz',
      rules: 'chess',
      white: { rating: 1500, result: 'win', username: 'Testeur' },
    },
  ],
};

export const SEPTEMBER_GAMES = {
  games: [
    {
      url: 'https://www.chess.com/game/live/999999999',
      pgn: CORRUPT_PGN,
      time_control: '300',
      end_time: at('2026-09-28T10:00:00Z'),
      rated: true,
      time_class: 'blitz',
      rules: 'chess',
      white: { rating: 1550, result: 'win', username: 'Testeur' },
      black: { rating: 1540, result: 'resigned', username: 'cassé' },
    },
  ],
};
