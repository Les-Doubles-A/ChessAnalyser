// Collecte du jeu de calibration de l'Elo (T10) depuis l'API publique chess.com.
// Usage : npm run dataset:collect -- [--max-games N] [--max-players N] [--pause ms]
//
// Requêtes strictement en série, espacées, avec un User-Agent qui donne un contact
// (documentation de l'API, R2). Point de départ : joueurs titrés et listes de pays, puis
// leurs adversaires, en visitant d'abord les tranches d'Elo et cadences les moins remplies.
// Reprise : data/games.jsonl et data/collect-state.json sont relus au lancement. La file
// d'attente contient des pseudos en clair ; elle est supprimée quand les quotas sont atteints.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ChessComClient, ChessComError, type GameSummary } from '../src/api/chesscom';
import { appendJsonl, dataPath, loadSecret, readJsonl } from './data-files';
import {
  candidateScore,
  countGame,
  MAX_GAMES_PER_PLAYER,
  nextCandidate,
  pickGames,
  pseudonymizer,
  quotaReport,
  toCollected,
  totalRemaining,
  type Candidate,
  type CollectedGame,
  type Counts,
} from './dataset';

const USER_AGENT = 'ChessAnalyser-calibration/0.1 (+contact: mada2068.jv@gmail.com)';
const SEED_LISTS = [
  ...['IM', 'FM', 'CM', 'NM', 'WFM'].map((title) => `https://api.chess.com/pub/titled/${title}`),
  ...['US', 'IN', 'FR', 'DE', 'BR', 'GB', 'PH', 'ES'].map(
    (iso) => `https://api.chess.com/pub/country/${iso}/players`,
  ),
];
const SEEDS_PER_LIST = 150;
const MAX_QUEUE = 30000;
const RETRY_WAIT_MS = 60000;
const MAX_FAILURES = 3;
const GAMES_FILE = 'games.jsonl';
const STATE_FILE = dataPath('collect-state.json');

const { values } = parseArgs({
  options: {
    'max-games': { type: 'string' },
    'max-players': { type: 'string', default: '5000' },
    pause: { type: 'string', default: '500' },
  },
});
const maxGames = values['max-games'] ? Number(values['max-games']) : Infinity;
const maxPlayers = Number(values['max-players']);
const pauseMs = Number(values.pause);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let lastRequest = 0;
async function politeFetch(input: string, init?: RequestInit): Promise<Response> {
  const wait = lastRequest + pauseMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', USER_AGENT);
  return fetch(input, { ...init, headers });
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

async function seedQueue(): Promise<Candidate[]> {
  const queue: Candidate[] = [];
  for (const url of SEED_LISTS) {
    const response = await politeFetch(url, { headers: { Accept: 'application/json' } });
    const body = (await response.json().catch(() => null)) as { players?: unknown } | null;
    const players = Array.isArray(body?.players)
      ? body.players.filter((p): p is string => typeof p === 'string')
      : [];
    if (!response.ok || players.length === 0) {
      console.warn(`Liste de départ indisponible : ${url} (HTTP ${response.status})`);
      continue;
    }
    for (const username of shuffle(players).slice(0, SEEDS_PER_LIST)) queue.push({ username });
  }
  return queue;
}

interface State {
  queue: Candidate[];
  /** Pseudonymes des joueurs déjà visités. */
  visited: string[];
}

function loadState(): State | null {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
}

const pseudo = pseudonymizer(loadSecret());
const counts: Counts = new Map();
const seen = new Set<string>();
for (const game of readJsonl<CollectedGame>(GAMES_FILE)) {
  countGame(counts, game);
  seen.add(game.id);
}

const client = new ChessComClient({ fetch: politeFetch });
const state = loadState() ?? { queue: await seedQueue(), visited: [] };
const queue = state.queue;
const visited = new Set(state.visited);
const queued = new Set(queue.map((c) => c.username.toLowerCase()));

const saveState = () =>
  writeFileSync(STATE_FILE, JSON.stringify({ queue, visited: [...visited] } satisfies State));

process.on('SIGINT', () => {
  saveState();
  console.log('\nArrêt demandé : état enregistré, relancer la même commande pour reprendre.');
  process.exit(130);
});

console.log(`Départ : ${seen.size} parties déjà collectées, ${queue.length} joueurs en file.`);
let added = 0;
let players = 0;
let failures = 0;

while (totalRemaining(counts) > 0 && players < maxPlayers && added < maxGames) {
  const index = nextCandidate(queue, counts, Math.random);
  if (index < 0) {
    console.log('Plus aucun joueur utile dans la file.');
    break;
  }
  const candidate = queue.splice(index, 1)[0]!;
  const name = candidate.username.toLowerCase();
  queued.delete(name);
  const key = pseudo(name);
  if (visited.has(key)) continue;

  let games: GameSummary[];
  try {
    games = (await client.getLatestGames(name)).games;
    failures = 0;
  } catch (error) {
    if (
      error instanceof ChessComError &&
      (error.kind === 'not-found' || error.kind === 'bad-response')
    ) {
      visited.add(key);
      continue;
    }
    queue.push(candidate);
    queued.add(name);
    if (++failures >= MAX_FAILURES) {
      saveState();
      console.error(
        'chess.com ne répond plus (blocage possible). État enregistré ; relancer plus tard.',
      );
      process.exitCode = 1;
      break;
    }
    console.warn(`chess.com indisponible (${failures}/${MAX_FAILURES}), nouvel essai dans 60 s.`);
    await sleep(RETRY_WAIT_MS);
    continue;
  }
  visited.add(key);
  players++;

  const picked = pickGames(
    games,
    counts,
    seen,
    pseudo,
    Math.min(MAX_GAMES_PER_PLAYER, maxGames - added),
  );
  for (const game of picked) appendJsonl(GAMES_FILE, toCollected(game, pseudo));
  added += picked.length;

  if (queue.length >= MAX_QUEUE) {
    const useful = queue.filter((c) => candidateScore(c, counts) > 0);
    queue.splice(0, queue.length, ...useful);
  }
  for (const game of games) {
    if (queue.length >= MAX_QUEUE) break;
    if (!game.rated || !game.supported || game.timeClass === 'unknown') continue;
    const opponent = game.white.username.toLowerCase() === name ? game.black : game.white;
    const opponentName = opponent.username.toLowerCase();
    if (queued.has(opponentName) || visited.has(pseudo(opponentName))) continue;
    queue.push({ username: opponentName, rating: opponent.rating, timeClass: game.timeClass });
    queued.add(opponentName);
  }

  if (players % 10 === 0) {
    saveState();
    console.log(
      `${players} joueurs visités, ${seen.size} parties (+${added}), ${totalRemaining(counts)} manquantes, file ${queue.length}`,
    );
  }
}

console.log(`\n${players} joueurs visités, ${added} parties ajoutées, ${seen.size} au total.`);
console.log(quotaReport(counts));
if (totalRemaining(counts) === 0) {
  rmSync(STATE_FILE, { force: true });
  console.log('Quotas atteints : file d’attente (pseudos en clair) supprimée.');
} else {
  saveState();
}
