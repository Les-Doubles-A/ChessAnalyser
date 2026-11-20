//! Parité avec le code TypeScript du site : `npm run golden:export` écrit ce que calcule le
//! TypeScript (FEN, coups, livre, classification, précision, synthèse, variables et estimation
//! Elo) ; le portage Rust doit retrouver les mêmes résultats. Le modèle Elo calibré par les
//! scripts Node n'est valable dans l'application qu'à cette condition.
//!
//! - `tests/golden/fixtures.json` (versionné) : parties des fixtures du dépôt.
//! - `../data/golden-dataset.json` (local, s'il existe) : jeu de calibration complet.

use std::collections::HashMap;

use chessanalyser::analysis::{
    Category, EloEstimate, OpeningIndex, PlayerFeatures, PresetModel, book_flags, build_report,
    estimate_elo, feature_vector, player_features, summarize_game,
};
use chessanalyser::chess::{Color, parse_game};
use chessanalyser::engine::{PositionEval, Score};
use serde::Deserialize;

#[derive(Deserialize)]
struct Golden {
    model: PresetModel,
    games: Vec<GoldenGame>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenGame {
    pgn: String,
    time_class: String,
    evals: Vec<GoldenEval>,
    fens: Vec<String>,
    plies: Vec<GoldenPly>,
    book: Vec<bool>,
    report: GoldenReport,
    opening: Option<GoldenOpening>,
    counts: HashMap<String, HashMap<String, usize>>,
    key_moments: Vec<usize>,
    white: GoldenSide,
    black: GoldenSide,
}

#[derive(Deserialize)]
struct GoldenEval {
    s: Score,
    b: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenPly {
    san: String,
    uci: String,
    color: String,
    move_number: u32,
    legal_move_count: usize,
    clock_seconds: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenMove {
    category: String,
    loss: f64,
    accuracy: f64,
    win_before: f64,
    win_after: f64,
    best_move_san: Option<String>,
}

#[derive(Deserialize)]
struct GoldenReport {
    moves: Vec<Option<GoldenMove>>,
    white: Option<f64>,
    black: Option<f64>,
    complete: bool,
}

#[derive(Deserialize)]
struct GoldenOpening {
    eco: String,
    name: String,
}

#[derive(Deserialize)]
struct GoldenSide {
    features: Option<PlayerFeatures>,
    vector: Option<Vec<f64>>,
    elo: Option<GoldenElo>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum GoldenElo {
    Estimate {
        value: f64,
        low: f64,
        high: f64,
        confidence: String,
    },
    TooShort,
    Unavailable,
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * (1.0 + a.abs().max(b.abs()))
}

fn check_features(name: &str, actual: Option<&PlayerFeatures>, expected: Option<&PlayerFeatures>) {
    match (actual, expected) {
        (None, None) => {}
        (Some(a), Some(e)) => {
            assert_eq!(a.moves, e.moves, "{name} : coups");
            for (label, x, y) in [
                ("précision", a.accuracy, e.accuracy),
                ("perte moyenne", a.mean_loss, e.mean_loss),
                ("imprécisions", a.inaccuracy_rate, e.inaccuracy_rate),
                ("erreurs", a.mistake_rate, e.mistake_rate),
                ("gaffes", a.blunder_rate, e.blunder_rate),
                ("perte disputée", a.balanced_loss, e.balanced_loss),
                ("part disputée", a.balanced_share, e.balanced_share),
                ("centipions", a.centipawn_loss, e.centipawn_loss),
                ("bons coups", a.good_move_rate, e.good_move_rate),
            ] {
                assert!(close(x, y), "{name} : {label} {x} au lieu de {y}");
            }
        }
        _ => panic!("{name} : variables présentes d'un seul côté"),
    }
}

fn check_game(index: usize, game: &GoldenGame, model: &PresetModel, openings: &OpeningIndex) {
    let name = format!("partie {index}");
    let parsed = parse_game(&game.pgn).unwrap_or_else(|e| panic!("{name} : {e}"));
    assert_eq!(parsed.fens(), game.fens, "{name} : FEN");
    assert_eq!(
        parsed.plies.len(),
        game.plies.len(),
        "{name} : nombre de coups"
    );
    for (ply, expected) in parsed.plies.iter().zip(&game.plies) {
        assert_eq!(ply.san, expected.san, "{name} : SAN");
        assert_eq!(ply.uci, expected.uci, "{name} : UCI");
        assert_eq!(ply.color.code(), expected.color, "{name} : couleur");
        assert_eq!(ply.move_number, expected.move_number, "{name} : numéro");
        assert_eq!(
            ply.legal_move_count, expected.legal_move_count,
            "{name} : coups légaux"
        );
        assert_eq!(
            ply.clock_seconds, expected.clock_seconds,
            "{name} : pendule"
        );
    }

    let fens_after: Vec<String> = parsed.plies.iter().map(|p| p.fen_after.clone()).collect();
    assert_eq!(
        book_flags(&fens_after, openings),
        game.book,
        "{name} : livre"
    );

    let fens = parsed.fens();
    let evals: Vec<Option<PositionEval>> = fens
        .iter()
        .enumerate()
        .map(|(i, fen)| {
            game.evals.get(i).map(|e| PositionEval {
                fen: fen.clone(),
                depth: 14,
                score: e.s,
                best_move_uci: e.b.clone(),
                pv: Vec::new(),
            })
        })
        .collect();
    let report = build_report(&parsed, &evals, Some(openings));
    assert_eq!(
        report.complete, game.report.complete,
        "{name} : analyse complète"
    );
    for (i, (actual, expected)) in report.moves.iter().zip(&game.report.moves).enumerate() {
        match (actual, expected) {
            (None, None) => {}
            (Some(a), Some(e)) => {
                assert_eq!(
                    a.category.code(),
                    e.category,
                    "{name}, coup {i} : catégorie"
                );
                assert!(close(a.loss, e.loss), "{name}, coup {i} : perte");
                assert!(
                    close(a.accuracy, e.accuracy),
                    "{name}, coup {i} : précision"
                );
                assert!(
                    close(a.win_before, e.win_before),
                    "{name}, coup {i} : Win% avant"
                );
                assert!(
                    close(a.win_after, e.win_after),
                    "{name}, coup {i} : Win% après"
                );
                assert_eq!(
                    a.best_move_san, e.best_move_san,
                    "{name}, coup {i} : meilleur coup"
                );
            }
            _ => panic!("{name}, coup {i} : analysé d'un seul côté"),
        }
    }
    for (label, actual, expected) in [
        ("blancs", report.accuracy.white, game.report.white),
        ("noirs", report.accuracy.black, game.report.black),
    ] {
        match (actual, expected) {
            (None, None) => {}
            (Some(a), Some(e)) => assert!(
                close(a, e),
                "{name} : précision des {label} {a} au lieu de {e}"
            ),
            _ => panic!("{name} : précision des {label} présente d'un seul côté"),
        }
    }

    let synthesis = summarize_game(&parsed, &report, openings);
    match (&synthesis.opening, &game.opening) {
        (None, None) => {}
        (Some(a), Some(e)) => {
            assert_eq!((&a.eco, &a.name), (&e.eco, &e.name), "{name} : ouverture")
        }
        _ => panic!("{name} : ouverture différente"),
    }
    for (color, counts) in [("w", &synthesis.white), ("b", &synthesis.black)] {
        let expected = &game.counts[color];
        for category in Category::ALL {
            assert_eq!(
                counts.get(category),
                expected[category.code()],
                "{name} : compte {}",
                category.code()
            );
        }
        assert_eq!(
            counts.unanalysed, expected["unanalysed"],
            "{name} : non analysés"
        );
    }
    let moments: Vec<usize> = synthesis.key_moments.iter().map(|m| m.ply_index).collect();
    assert_eq!(moments, game.key_moments, "{name} : moments clés");

    for (color, side) in [(Color::White, &game.white), (Color::Black, &game.black)] {
        let features = player_features(&report, color);
        let label = format!("{name} ({})", color.code());
        check_features(&label, features.as_ref(), side.features.as_ref());
        if let (Some(f), Some(vector)) = (&features, &side.vector) {
            let actual = feature_vector(f, &game.time_class);
            assert_eq!(actual.len(), vector.len(), "{label} : vecteur");
            for (x, y) in actual.iter().zip(vector) {
                assert!(close(*x, *y), "{label} : vecteur {x} au lieu de {y}");
            }
        }
        let estimate = estimate_elo(features.as_ref(), &game.time_class, Some(model));
        match (estimate, &side.elo) {
            (None, None) => {}
            (Some(EloEstimate::TooShort), Some(GoldenElo::TooShort)) => {}
            (Some(EloEstimate::Unavailable), Some(GoldenElo::Unavailable)) => {}
            (
                Some(EloEstimate::Estimate {
                    value,
                    low,
                    high,
                    confidence,
                }),
                Some(GoldenElo::Estimate {
                    value: v,
                    low: l,
                    high: h,
                    confidence: c,
                }),
            ) => {
                assert_eq!((value, low, high), (*v, *l, *h), "{label} : Elo");
                assert_eq!(confidence.label(), c, "{label} : confiance");
            }
            (a, _) => panic!("{label} : estimation Elo différente ({a:?})"),
        }
    }
}

fn run(path: &str) -> Option<usize> {
    let text = std::fs::read_to_string(path).ok()?;
    let golden: Golden = serde_json::from_str(&text).expect("jeu de référence lisible");
    let openings = OpeningIndex::embedded();
    for (i, game) in golden.games.iter().enumerate() {
        check_game(i, game, &golden.model, &openings);
    }
    Some(golden.games.len())
}

#[test]
fn parite_avec_le_typescript_sur_les_fixtures() {
    let count = run(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/golden/fixtures.json"
    ))
    .expect("tests/golden/fixtures.json : lancer npm run golden:export");
    assert!(count >= 5);
}

#[test]
fn parite_avec_le_typescript_sur_le_jeu_local() {
    match run(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../data/golden-dataset.json"
    )) {
        Some(count) => eprintln!("{count} parties du jeu local vérifiées"),
        None => eprintln!("data/golden-dataset.json absent : vérification sautée"),
    }
}
