import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">ChessAnalyser</span>
        <span className="tagline">Revue de parties chess.com, calculée dans votre navigateur</span>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">Projet indépendant, non affilié à Chess.com</footer>
    </div>
  );
}
