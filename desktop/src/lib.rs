//! ChessAnalyser, application de bureau : revue de parties chess.com analysées par Stockfish
//! natif. Le cœur (analyse, échecs, API) est un portage fidèle du code TypeScript du site
//! (`../src`) ; `tests/golden.rs` vérifie qu'il en retrouve exactement les résultats, condition
//! pour que le modèle Elo calibré par les scripts Node reste valable ici.

pub mod analysis;
pub mod chess;
pub mod chesscom;
pub mod engine;
pub mod storage;
pub mod ui;
