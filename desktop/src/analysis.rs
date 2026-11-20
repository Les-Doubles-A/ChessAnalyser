//! Analyse d'une partie : portage exact de `src/analysis/*.ts` (probabilité de gain,
//! précision Lichess, classification, rapport, ouvertures, synthèse, estimation d'Elo).
//! L'ordre des opérations flottantes suit le TypeScript, pour retrouver les mêmes valeurs.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use crate::chess::{Color, ParsedGame, uci_to_san};
use crate::engine::{PositionEval, Score};

// ---------------------------------------------------------------------------------------
// Probabilité de gain (winPercent.ts), d'après Lichess.

pub const CP_CEILING: f64 = 1000.0;
const MULTIPLIER: f64 = -0.00368208;

pub fn win_percent_from_cp(cp: f64) -> f64 {
    let clamped = (-CP_CEILING).max(CP_CEILING.min(cp));
    let chances = 2.0 / (1.0 + (MULTIPLIER * clamped).exp()) - 1.0;
    50.0 + 50.0 * (-1.0f64).max(1.0f64.min(chances))
}

/// Probabilité de gain des blancs utilisée pour les pertes et la précision.
pub fn white_win_percent(score: &Score) -> f64 {
    match score {
        Score::Cp(cp) => win_percent_from_cp(*cp as f64),
        Score::Mate { winner, .. } => win_percent_from_cp(if *winner == Color::White {
            CP_CEILING
        } else {
            -CP_CEILING
        }),
    }
}

/// Part blanche de la barre d'évaluation, de 0 à 100 ; un mat remplit la barre.
pub fn white_bar_percent(score: &Score) -> f64 {
    match score {
        Score::Mate { winner, .. } => {
            if *winner == Color::White {
                100.0
            } else {
                0.0
            }
        }
        Score::Cp(cp) => win_percent_from_cp(*cp as f64),
    }
}

/// Libellé de la barre : « +1.5 », « -0.8 », « M3 », « -M3 », « Mat ».
pub fn format_score(score: &Score) -> String {
    match score {
        Score::Mate { mate: 0, .. } => "Mat".into(),
        Score::Mate { mate, winner } => {
            format!("{}M{mate}", if *winner == Color::White { "" } else { "-" })
        }
        Score::Cp(cp) => {
            let pawns = *cp as f64 / 100.0;
            let text = format!("{:.1}", pawns.abs());
            if text == "0.0" {
                return text;
            }
            format!("{}{text}", if pawns > 0.0 { "+" } else { "-" })
        }
    }
}

// ---------------------------------------------------------------------------------------
// Précision (accuracy.ts), portage de lila AccuracyPercent.

pub fn move_accuracy(win_before: f64, win_after: f64) -> f64 {
    if win_after >= win_before {
        return 100.0;
    }
    let win_diff = win_before - win_after;
    let raw = 103.1668100711649 * (-0.04354415386753951 * win_diff).exp() - 3.166924740191411;
    0.0f64.max(100.0f64.min(raw + 1.0))
}

fn standard_deviation(values: &[f64]) -> f64 {
    let n = values.len() as f64;
    let mean = values.iter().fold(0.0, |sum, v| sum + v) / n;
    let variance = values.iter().fold(0.0, |sum, v| sum + (v - mean).powi(2)) / n;
    variance.sqrt()
}

fn sliding(items: &[f64], size: usize) -> Vec<Vec<f64>> {
    if items.len() <= size {
        return if items.is_empty() {
            Vec::new()
        } else {
            vec![items.to_vec()]
        };
    }
    (0..=items.len() - size)
        .map(|i| items[i..i + size].to_vec())
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct GameAccuracy {
    pub white: Option<f64>,
    pub black: Option<f64>,
}

/// `win_percents` : Win% des blancs pour chaque position, position de départ comprise.
pub fn game_accuracy(win_percents: &[f64], start_color: Color) -> GameAccuracy {
    let n = win_percents.len();
    let window_size = 2usize.max(8usize.min(n.saturating_sub(1) / 10));
    let mut windows: Vec<Vec<f64>> = Vec::new();
    let repeat = window_size.min(n).saturating_sub(2);
    for _ in 0..repeat {
        windows.push(win_percents[..window_size.min(n)].to_vec());
    }
    windows.extend(sliding(win_percents, window_size));
    let weights: Vec<f64> = windows
        .iter()
        .map(|w| 0.5f64.max(12.0f64.min(standard_deviation(w))))
        .collect();

    let mut white: Vec<(f64, f64)> = Vec::new();
    let mut black: Vec<(f64, f64)> = Vec::new();
    let pairs = n.saturating_sub(1);
    for i in 0..pairs.min(weights.len()) {
        let prev = win_percents[i];
        let next = win_percents[i + 1];
        let is_white = (i % 2 == 0) == (start_color == Color::White);
        let accuracy = if is_white {
            move_accuracy(prev, next)
        } else {
            move_accuracy(100.0 - prev, 100.0 - next)
        };
        if is_white {
            white.push((accuracy, weights[i]))
        } else {
            black.push((accuracy, weights[i]))
        }
    }

    let aggregate = |items: &[(f64, f64)]| -> Option<f64> {
        if items.is_empty() {
            return None;
        }
        let total_weight = items.iter().fold(0.0, |sum, x| sum + x.1);
        let weighted = items.iter().fold(0.0, |sum, x| sum + x.0 * x.1) / total_weight;
        let inverse_sum = items.iter().fold(0.0, |sum, x| sum + 1.0 / x.0);
        let harmonic = items.len() as f64 / inverse_sum;
        Some((weighted + harmonic) / 2.0)
    };
    GameAccuracy {
        white: aggregate(&white),
        black: aggregate(&black),
    }
}

// ---------------------------------------------------------------------------------------
// Classification (classify.ts).

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Category {
    Book,
    Forced,
    Best,
    Excellent,
    Good,
    Inaccuracy,
    Mistake,
    Blunder,
}

impl Category {
    pub const ALL: [Category; 8] = [
        Category::Book,
        Category::Forced,
        Category::Best,
        Category::Excellent,
        Category::Good,
        Category::Inaccuracy,
        Category::Mistake,
        Category::Blunder,
    ];

    pub fn code(self) -> &'static str {
        match self {
            Category::Book => "book",
            Category::Forced => "forced",
            Category::Best => "best",
            Category::Excellent => "excellent",
            Category::Good => "good",
            Category::Inaccuracy => "inaccuracy",
            Category::Mistake => "mistake",
            Category::Blunder => "blunder",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Category::Book => "Livre",
            Category::Forced => "Forcé",
            Category::Best => "Meilleur",
            Category::Excellent => "Excellent",
            Category::Good => "Bon",
            Category::Inaccuracy => "Imprécision",
            Category::Mistake => "Erreur",
            Category::Blunder => "Gaffe",
        }
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Category::Book => "L",
            Category::Forced => "□",
            Category::Best => "!",
            Category::Excellent | Category::Good => "",
            Category::Inaccuracy => "?!",
            Category::Mistake => "?",
            Category::Blunder => "??",
        }
    }

    /// Catégories qui méritent l'affichage du meilleur coup.
    pub fn is_error(self) -> bool {
        matches!(
            self,
            Category::Inaccuracy | Category::Mistake | Category::Blunder
        )
    }
}

pub const THRESHOLD_EXCELLENT: f64 = 2.0;
pub const THRESHOLD_GOOD: f64 = 5.0;
pub const THRESHOLD_INACCURACY: f64 = 10.0;
pub const THRESHOLD_MISTAKE: f64 = 20.0;

pub fn move_loss(win_before: f64, win_after: f64) -> f64 {
    0.0f64.max(win_before - win_after)
}

pub fn loss_category(loss: f64) -> Category {
    if loss < THRESHOLD_EXCELLENT {
        Category::Excellent
    } else if loss < THRESHOLD_GOOD {
        Category::Good
    } else if loss < THRESHOLD_INACCURACY {
        Category::Inaccuracy
    } else if loss < THRESHOLD_MISTAKE {
        Category::Mistake
    } else {
        Category::Blunder
    }
}

pub struct MoveFacts<'a> {
    pub win_before: f64,
    pub win_after: f64,
    pub played_uci: &'a str,
    pub best_uci: Option<&'a str>,
    pub legal_move_count: usize,
    pub is_book: bool,
}

pub fn classify(facts: &MoveFacts<'_>) -> Category {
    let loss = move_loss(facts.win_before, facts.win_after);
    // La base Lichess nomme aussi des pièges : un coup « livre » qui perd au moins une
    // imprécision est classé selon sa perte.
    if facts.is_book && loss < THRESHOLD_GOOD {
        return Category::Book;
    }
    if facts.legal_move_count == 1 {
        return Category::Forced;
    }
    if facts.best_uci == Some(facts.played_uci) {
        return Category::Best;
    }
    loss_category(loss)
}

// ---------------------------------------------------------------------------------------
// Ouvertures (openings.ts), base Lichess (CC0) générée par scripts/build-openings.ts.

#[derive(Clone, Debug, PartialEq)]
pub struct Opening {
    pub eco: String,
    pub name: String,
}

#[derive(Deserialize)]
struct OpeningData {
    names: HashMap<String, Vec<String>>,
    book: Vec<String>,
}

pub struct OpeningIndex {
    names: HashMap<String, Opening>,
    book: HashSet<String>,
}

/// EPD au sens de la base Lichess : les 4 premiers champs du FEN.
pub fn to_epd(fen: &str) -> String {
    fen.split(' ').take(4).collect::<Vec<_>>().join(" ")
}

impl OpeningIndex {
    pub fn from_json(json: &str) -> serde_json::Result<OpeningIndex> {
        let data: OpeningData = serde_json::from_str(json)?;
        let names = data
            .names
            .into_iter()
            .map(|(epd, entry)| {
                let eco = entry.first().cloned().unwrap_or_default();
                let name = entry.get(1).cloned().unwrap_or_default();
                (epd, Opening { eco, name })
            })
            .collect();
        Ok(OpeningIndex {
            names,
            book: data.book.into_iter().collect(),
        })
    }

    /// Base embarquée dans l'exécutable (même fichier que le site).
    pub fn embedded() -> OpeningIndex {
        OpeningIndex::from_json(include_str!("../../src/data/openings.json"))
            .expect("base d'ouvertures embarquée lisible")
    }

    pub fn is_book(&self, fen: &str) -> bool {
        let epd = to_epd(fen);
        self.names.contains_key(&epd) || self.book.contains(&epd)
    }

    pub fn name_of(&self, fen: &str) -> Option<&Opening> {
        self.names.get(&to_epd(fen))
    }
}

/// Coups « livre » : vrai jusqu'au premier coup qui sort de la base, faux ensuite.
pub fn book_flags(fens_after: &[String], index: &OpeningIndex) -> Vec<bool> {
    let mut in_book = true;
    fens_after
        .iter()
        .map(|fen| {
            in_book = in_book && index.is_book(fen);
            in_book
        })
        .collect()
}

/// Dernière position nommée avant de quitter la base.
pub fn opening_of(fens_after: &[String], index: &OpeningIndex) -> Option<Opening> {
    let mut found = None;
    for fen in fens_after {
        if !index.is_book(fen) {
            break;
        }
        if let Some(opening) = index.name_of(fen) {
            found = Some(opening.clone());
        }
    }
    found
}

// ---------------------------------------------------------------------------------------
// Rapport de partie (report.ts).

#[derive(Clone, Debug, PartialEq)]
pub struct MoveAnalysis {
    pub ply_index: usize,
    pub color: Color,
    /// Win% du joueur avant (meilleur coup supposé) et après son coup.
    pub win_before: f64,
    pub win_after: f64,
    pub loss: f64,
    pub accuracy: f64,
    pub category: Category,
    pub best_move_uci: Option<String>,
    pub best_move_san: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct GameReport {
    /// moves[i] concerne plies[i] ; None si non analysé.
    pub moves: Vec<Option<MoveAnalysis>>,
    pub accuracy: GameAccuracy,
    pub complete: bool,
}

pub fn build_report(
    game: &ParsedGame,
    evals: &[Option<PositionEval>],
    openings: Option<&OpeningIndex>,
) -> GameReport {
    let fens_after: Vec<String> = game.plies.iter().map(|p| p.fen_after.clone()).collect();
    let book = match openings {
        Some(index) => book_flags(&fens_after, index),
        None => vec![false; game.plies.len()],
    };

    let moves = game
        .plies
        .iter()
        .enumerate()
        .map(|(i, ply)| {
            let before = evals.get(i)?.as_ref()?;
            let after = evals.get(i + 1)?.as_ref()?;
            let mover = |score: &Score| {
                if ply.color == Color::White {
                    white_win_percent(score)
                } else {
                    100.0 - white_win_percent(score)
                }
            };
            let win_before = mover(&before.score);
            let win_after = mover(&after.score);
            let category = classify(&MoveFacts {
                win_before,
                win_after,
                played_uci: &ply.uci,
                best_uci: before.best_move_uci.as_deref(),
                legal_move_count: ply.legal_move_count,
                is_book: book[i],
            });
            Some(MoveAnalysis {
                ply_index: ply.index,
                color: ply.color,
                win_before,
                win_after,
                loss: move_loss(win_before, win_after),
                accuracy: move_accuracy(win_before, win_after),
                category,
                best_move_uci: before.best_move_uci.clone(),
                best_move_san: before
                    .best_move_uci
                    .as_deref()
                    .and_then(|uci| uci_to_san(&ply.fen_before, uci)),
            })
        })
        .collect();

    // Précision sur la suite continue de positions évaluées depuis le départ.
    let mut prefix = Vec::new();
    for evaluation in evals.iter().take(game.plies.len() + 1) {
        match evaluation {
            Some(e) => prefix.push(white_win_percent(&e.score)),
            None => break,
        }
    }
    let start_color = game.plies.first().map_or(Color::White, |p| p.color);
    let complete = prefix.len() == game.plies.len() + 1;
    GameReport {
        moves,
        accuracy: game_accuracy(&prefix, start_color),
        complete,
    }
}

// ---------------------------------------------------------------------------------------
// Synthèse (keyMoments.ts).

pub const KEY_MOMENT_COUNT: usize = 3;

/// Compte par catégorie ; `None` désigne « Non analysé ». La somme égale le nombre de coups.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CategoryCounts {
    pub by_category: HashMap<Category, usize>,
    pub unanalysed: usize,
}

impl CategoryCounts {
    pub fn get(&self, category: Category) -> usize {
        self.by_category.get(&category).copied().unwrap_or(0)
    }
}

pub fn count_categories(
    game: &ParsedGame,
    report: &GameReport,
) -> (CategoryCounts, CategoryCounts) {
    let mut white = CategoryCounts::default();
    let mut black = CategoryCounts::default();
    for (i, ply) in game.plies.iter().enumerate() {
        let counts = if ply.color == Color::White {
            &mut white
        } else {
            &mut black
        };
        match report.moves.get(i).and_then(|m| m.as_ref()) {
            Some(m) => *counts.by_category.entry(m.category).or_insert(0) += 1,
            None => counts.unanalysed += 1,
        }
    }
    (white, black)
}

/// Les coups de plus forte perte parmi les erreurs et gaffes, remis dans l'ordre chronologique.
pub fn key_moments(moves: &[Option<MoveAnalysis>]) -> Vec<MoveAnalysis> {
    let mut serious: Vec<MoveAnalysis> = moves
        .iter()
        .flatten()
        .filter(|m| matches!(m.category, Category::Mistake | Category::Blunder))
        .cloned()
        .collect();
    serious.sort_by(|a, b| {
        b.loss
            .partial_cmp(&a.loss)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.ply_index.cmp(&b.ply_index))
    });
    serious.truncate(KEY_MOMENT_COUNT);
    serious.sort_by_key(|m| m.ply_index);
    serious
}

pub struct GameSynthesis {
    pub white: CategoryCounts,
    pub black: CategoryCounts,
    pub opening: Option<Opening>,
    pub key_moments: Vec<MoveAnalysis>,
}

pub fn summarize_game(
    game: &ParsedGame,
    report: &GameReport,
    openings: &OpeningIndex,
) -> GameSynthesis {
    let (white, black) = count_categories(game, report);
    let fens_after: Vec<String> = game.plies.iter().map(|p| p.fen_after.clone()).collect();
    GameSynthesis {
        white,
        black,
        opening: opening_of(&fens_after, openings),
        key_moments: key_moments(&report.moves),
    }
}

// ---------------------------------------------------------------------------------------
// Estimation d'Elo (elo.ts).

pub const ELO_MIN: f64 = 100.0;
pub const ELO_MAX: f64 = 3200.0;
pub const MIN_NON_BOOK_MOVES: usize = 10;
const NO_BALANCED_LOSS: f64 = 10.0;

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerFeatures {
    pub accuracy: f64,
    pub mean_loss: f64,
    pub inaccuracy_rate: f64,
    pub mistake_rate: f64,
    pub blunder_rate: f64,
    pub balanced_loss: f64,
    pub balanced_share: f64,
    pub centipawn_loss: f64,
    pub good_move_rate: f64,
    pub moves: usize,
}

fn to_centipawns(win: f64) -> f64 {
    let w = 99.0f64.min(1.0f64.max(win));
    (w / (100.0 - w)).ln() / 0.00368208
}

fn mean(values: &[f64], empty: f64) -> f64 {
    if values.is_empty() {
        empty
    } else {
        values.iter().fold(0.0, |sum, v| sum + v) / values.len() as f64
    }
}

/// Variables d'un joueur ; None si l'analyse est incomplète.
pub fn player_features(report: &GameReport, color: Color) -> Option<PlayerFeatures> {
    if !report.complete {
        return None;
    }
    // Analyse complète : la précision n'est absente que si ce camp n'a joué aucun coup.
    let accuracy = if color == Color::White {
        report.accuracy.white
    } else {
        report.accuracy.black
    }
    .unwrap_or(0.0);
    let own: Vec<&MoveAnalysis> = report
        .moves
        .iter()
        .flatten()
        .filter(|m| m.color == color && m.category != Category::Book)
        .collect();
    let n = own.len();
    let rate = |categories: &[Category]| {
        if n == 0 {
            0.0
        } else {
            own.iter()
                .filter(|m| categories.contains(&m.category))
                .count() as f64
                / n as f64
        }
    };
    let balanced: Vec<&&MoveAnalysis> = own
        .iter()
        .filter(|m| m.win_before >= 20.0 && m.win_before <= 80.0)
        .collect();
    Some(PlayerFeatures {
        accuracy,
        mean_loss: mean(&own.iter().map(|m| m.loss).collect::<Vec<_>>(), 0.0),
        inaccuracy_rate: rate(&[Category::Inaccuracy]),
        mistake_rate: rate(&[Category::Mistake]),
        blunder_rate: rate(&[Category::Blunder]),
        balanced_loss: mean(
            &balanced.iter().map(|m| m.loss).collect::<Vec<_>>(),
            NO_BALANCED_LOSS,
        ),
        balanced_share: if n == 0 {
            0.0
        } else {
            balanced.len() as f64 / n as f64
        },
        centipawn_loss: mean(
            &own.iter()
                .map(|m| {
                    500.0f64
                        .min(0.0f64.max(to_centipawns(m.win_before) - to_centipawns(m.win_after)))
                })
                .collect::<Vec<_>>(),
            0.0,
        ),
        good_move_rate: rate(&[Category::Best, Category::Excellent]),
        moves: n,
    })
}

pub const FEATURE_NAMES: [&str; 15] = [
    "constante",
    "precision",
    "precision2",
    "logPerteMoyenne",
    "tauxImprecisions",
    "tauxErreurs",
    "tauxGaffes",
    "logPertePositionDisputee",
    "partPositionsDisputees",
    "logPerteCentipions",
    "tauxBonsCoups",
    "logCoups",
    "bullet",
    "rapide",
    "daily",
];

pub fn feature_vector(f: &PlayerFeatures, time_class: &str) -> Vec<f64> {
    let accuracy = f.accuracy / 100.0;
    vec![
        1.0,
        accuracy,
        accuracy * accuracy,
        f.mean_loss.ln_1p(),
        f.inaccuracy_rate,
        f.mistake_rate,
        f.blunder_rate,
        f.balanced_loss.ln_1p(),
        f.balanced_share,
        f.centipawn_loss.ln_1p(),
        f.good_move_rate,
        (f.moves.max(1) as f64).ln(),
        if time_class == "bullet" { 1.0 } else { 0.0 },
        if time_class == "rapid" { 1.0 } else { 0.0 },
        if time_class == "daily" { 1.0 } else { 0.0 },
    ]
}

#[derive(Clone, Debug, Deserialize)]
pub struct PresetModel {
    pub coefficients: Vec<f64>,
    pub lower: f64,
    pub upper: f64,
    pub samples: u32,
    pub depth: u32,
    pub engine: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct EloModel {
    pub features: Vec<String>,
    pub presets: HashMap<String, PresetModel>,
}

impl EloModel {
    /// Modèle calibré avec le Stockfish natif (`npm run elo:calibrate -- --engine native`).
    pub fn embedded() -> EloModel {
        serde_json::from_str(include_str!("../data/elo-model.json"))
            .expect("modèle Elo embarqué lisible")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Confidence {
    Low,
    Medium,
    Good,
}

impl Confidence {
    pub fn label(self) -> &'static str {
        match self {
            Confidence::Low => "faible",
            Confidence::Medium => "moyenne",
            Confidence::Good => "bonne",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum EloEstimate {
    Estimate {
        value: f64,
        low: f64,
        high: f64,
        confidence: Confidence,
    },
    TooShort,
    Unavailable,
}

fn clamp_elo(value: f64) -> f64 {
    ELO_MIN.max(ELO_MAX.min(value))
}

/// Arrondi à 50, comme `Math.round` de JavaScript (les demis vont vers +∞).
pub fn round_to_50(value: f64) -> f64 {
    (clamp_elo(value) / 50.0 + 0.5).floor() * 50.0
}

/// Largeur de l'intervalle à 80 % : plus de 700 points, la confiance est faible.
pub fn confidence_of(low: f64, high: f64) -> Confidence {
    let width = high - low;
    if width <= 400.0 {
        Confidence::Good
    } else if width <= 700.0 {
        Confidence::Medium
    } else {
        Confidence::Low
    }
}

pub fn predict(model: &PresetModel, x: &[f64]) -> f64 {
    model
        .coefficients
        .iter()
        .enumerate()
        .fold(0.0, |sum, (i, c)| {
            sum + c * x.get(i).copied().unwrap_or(0.0)
        })
}

/// None si l'analyse est incomplète, « trop courte » sous 10 coups hors livre, bornée à
/// [100, 3200] et arrondie à 50. La confiance se calcule avant le bornage.
pub fn estimate_elo(
    features: Option<&PlayerFeatures>,
    time_class: &str,
    model: Option<&PresetModel>,
) -> Option<EloEstimate> {
    let features = features?;
    if features.moves < MIN_NON_BOOK_MOVES {
        return Some(EloEstimate::TooShort);
    }
    let Some(model) = model else {
        return Some(EloEstimate::Unavailable);
    };
    let raw = predict(model, &feature_vector(features, time_class));
    Some(EloEstimate::Estimate {
        value: round_to_50(raw),
        low: round_to_50(raw + model.lower),
        high: round_to_50(raw + model.upper),
        confidence: confidence_of(raw + model.lower, raw + model.upper),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precision_de_reference_ac_f5_5() {
        // tests/fixtures/game-ref-01.ts : valeurs d'une implémentation Python indépendante.
        let cps = [
            15, 30, 20, 45, -120, -100, -110, 60, 50, 300, 280, 290, 250, 900, 880, -50, -40, -60,
            -30, 1200, 1500,
        ];
        let wins: Vec<f64> = cps
            .iter()
            .map(|cp| win_percent_from_cp(*cp as f64))
            .collect();
        let accuracy = game_accuracy(&wins, Color::White);
        assert!((accuracy.white.unwrap() - 65.51339688082354).abs() < 1e-9);
        assert!((accuracy.black.unwrap() - 98.68890586410473).abs() < 1e-9);
    }

    #[test]
    fn arrondi_comme_javascript() {
        assert_eq!(round_to_50(1474.0), 1450.0);
        assert_eq!(round_to_50(1475.0), 1500.0);
        assert_eq!(round_to_50(-20.0), ELO_MIN);
        assert_eq!(confidence_of(1400.0, 1800.0), Confidence::Good);
        assert_eq!(confidence_of(1150.0, 1900.0), Confidence::Low);
    }

    #[test]
    fn libelles_de_score() {
        assert_eq!(format_score(&Score::Cp(150)), "+1.5");
        assert_eq!(format_score(&Score::Cp(-4)), "0.0");
        assert_eq!(
            format_score(&Score::Mate {
                mate: 3,
                winner: Color::Black
            }),
            "-M3"
        );
        assert_eq!(
            format_score(&Score::Mate {
                mate: 0,
                winner: Color::White
            }),
            "Mat"
        );
    }
}
