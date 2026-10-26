import { useCallback, useRef, useState } from 'react';
import { ChessComClient, ChessComError, validateUsername, type GameSummary } from './api/chesscom';
import { loadPrefs, savePrefs } from './storage';
import { AnalysisView } from './ui/AnalysisView';
import { GameList } from './ui/GameList';
import { Layout } from './ui/Layout';
import { SearchForm } from './ui/SearchForm';

const client = new ChessComClient();

export type ListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      username: string;
      archives: string[];
      /** Index de la plus ancienne archive chargée. */
      oldestIndex: number;
      games: GameSummary[];
      loadingMore: boolean;
      moreError?: string;
    };

const UNAVAILABLE = 'chess.com ne répond pas.';

export function App() {
  const [query, setQuery] = useState(() => loadPrefs().lastUsername ?? '');
  const [formError, setFormError] = useState<string>();
  const [list, setList] = useState<ListState>({ status: 'idle' });
  const [selected, setSelected] = useState<{ game: GameSummary; username: string }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQuery = useRef('');

  const search = useCallback(async (raw: string) => {
    const check = validateUsername(raw);
    if (!check.ok) {
      setFormError(check.message);
      inputRef.current?.focus();
      return;
    }
    const username = check.value;
    lastQuery.current = username;
    setFormError(undefined);
    setList({ status: 'loading' });
    savePrefs({ lastUsername: username });
    try {
      const { archives, index, games } = await client.getLatestGames(username);
      if (lastQuery.current !== username) return;
      setList({
        status: 'ready',
        username,
        archives,
        oldestIndex: index,
        games,
        loadingMore: false,
      });
    } catch (error) {
      if (lastQuery.current !== username) return;
      if (error instanceof ChessComError && error.kind === 'not-found') {
        setList({ status: 'idle' });
        setFormError(`Aucun joueur chess.com ne porte le pseudo « ${username} ».`);
        inputRef.current?.focus();
      } else {
        setList({ status: 'error', message: UNAVAILABLE });
      }
    }
  }, []);

  const loadPreviousMonth = useCallback(async () => {
    if (list.status !== 'ready' || list.oldestIndex <= 0) return;
    const { username } = list;
    const index = list.oldestIndex - 1;
    setList({ ...list, loadingMore: true, moreError: undefined });
    try {
      const older = await client.getMonth(list.archives[index]!);
      setList((current) =>
        current.status === 'ready' && current.username === username
          ? {
              ...current,
              oldestIndex: index,
              games: [...current.games, ...older],
              loadingMore: false,
            }
          : current,
      );
    } catch {
      setList((current) =>
        current.status === 'ready' && current.username === username
          ? { ...current, loadingMore: false, moreError: UNAVAILABLE }
          : current,
      );
    }
  }, [list]);

  if (selected) {
    return (
      <Layout>
        <AnalysisView
          game={selected.game}
          username={selected.username}
          onBack={() => setSelected(undefined)}
        />
      </Layout>
    );
  }

  return (
    <Layout>
      <SearchForm
        ref={inputRef}
        value={query}
        onChange={setQuery}
        error={formError}
        busy={list.status === 'loading'}
        onSubmit={search}
      />
      <GameList
        state={list}
        onRetry={() => search(lastQuery.current)}
        onLoadMore={loadPreviousMonth}
        onOpen={(game, username) => setSelected({ game, username })}
      />
    </Layout>
  );
}
