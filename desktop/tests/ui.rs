//! Parcours de l'écran d'analyse avec le vrai moteur (desktop/engine/stockfish.exe) :
//! navigation (boutons et clavier), moments clés, variantes au clavier et à l'échiquier,
//! Début et Fin dans une variante, choix de la pièce de promotion.

use std::{thread, time::Duration};

use chessanalyser::chesscom::{GameSummary, PlayerSide, count_moves};
use chessanalyser::engine::default_engine_path;
use chessanalyser::ui::ChessApp;
use eframe::egui::{self, Pos2, Role};
use egui_kittest::{Harness, kittest::Queryable};

fn opera() -> GameSummary {
    let golden: serde_json::Value =
        serde_json::from_str(include_str!("golden/fixtures.json")).unwrap();
    let pgn = golden["games"][0]["pgn"].as_str().unwrap().to_string();
    let side = |name: &str, result: &str| PlayerSide {
        username: name.into(),
        rating: 1600,
        result: result.into(),
    };
    GameSummary {
        url: "https://www.chess.com/game/live/1".into(),
        end_time: 1_792_000_000,
        time_class: "rapid".into(),
        rules: "chess".into(),
        rated: true,
        white: side("morphy_fan", "win"),
        black: side("testeur", "resigned"),
        move_count: count_moves(&pgn),
        pgn,
        supported: true,
    }
}

fn harness() -> Option<Harness<'static, ChessApp>> {
    if !default_engine_path().exists() {
        eprintln!("Stockfish absent : lancer desktop/fetch-stockfish.ps1");
        return None;
    }
    let mut harness = Harness::builder()
        .with_size(egui::vec2(1400.0, 1000.0))
        .build_eframe(|cc| {
            let mut app = ChessApp::new(cc);
            // Vue côté blancs : le joueur recherché a les blancs.
            app.open(opera(), "morphy_fan".into());
            app
        });
    for _ in 0..1200 {
        harness.step();
        if harness.state().analysis_finished() {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    assert!(harness.state().analysis_finished(), "analyse non terminée");
    settle(&mut harness);
    Some(harness)
}

/// Quelques images pour que l'interface tienne compte des derniers événements.
fn settle(harness: &mut Harness<'_, ChessApp>) {
    harness.run_steps(6);
}

fn has(harness: &Harness<'_, ChessApp>, label: &str) -> bool {
    harness.query_all_by_label(label).next().is_some()
}

fn click_at(harness: &Harness<'_, ChessApp>, pos: Pos2) {
    harness.hover_at(pos);
    for pressed in [true, false] {
        harness.event(egui::Event::PointerButton {
            pos,
            button: egui::PointerButton::Primary,
            pressed,
            modifiers: egui::Modifiers::NONE,
        });
    }
}

/// Centre d'une case, échiquier vu côté blancs.
fn square_center(harness: &Harness<'_, ChessApp>, square: &str) -> Pos2 {
    let rect = harness.get_by_label_contains("Échiquier").rect();
    let cell = rect.width() / 8.0;
    let file = (square.as_bytes()[0] - b'a') as f32;
    let rank = (square.as_bytes()[1] - b'1') as f32;
    Pos2::new(
        rect.min.x + (file + 0.5) * cell,
        rect.min.y + (7.0 - rank + 0.5) * cell,
    )
}

fn play(harness: &mut Harness<'_, ChessApp>, moves: &[&str]) {
    for mv in moves {
        harness
            .get_by_role_and_label(Role::TextInput, "Jouer un coup")
            .click();
        settle(harness);
        harness
            .get_by_role_and_label(Role::TextInput, "Jouer un coup")
            .type_text(mv);
        settle(harness);
        harness.key_press(egui::Key::Enter);
        settle(harness);
    }
}

fn wait_label(harness: &mut Harness<'_, ChessApp>, label: &str) {
    for _ in 0..400 {
        harness.step();
        if harness.query_by_label_contains(label).is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    panic!("libellé introuvable : {label}");
}

#[test]
fn navigation_moments_cles_et_variantes() {
    let Some(mut harness) = harness() else { return };
    harness.get_by_label_contains("Analyse terminée (Standard, profondeur 14)");
    assert!(has(&harness, "Position de départ"));

    harness.get_by_label("Suivant").click();
    settle(&mut harness);
    harness.get_by_label("Demi-coup 1 sur 33");

    harness.key_press(egui::Key::End);
    settle(&mut harness);
    harness.get_by_label("Demi-coup 33 sur 33");
    harness.key_press(egui::Key::Home);
    settle(&mut harness);
    assert!(has(&harness, "Position de départ"));

    // Moment clé : l'échiquier s'y place.
    harness
        .get_all_by_label_contains("meilleur :")
        .next()
        .expect("un moment clé")
        .click();
    settle(&mut harness);
    assert!(!has(&harness, "Position de départ"));

    // Variante au clavier : le coup de la partie avance, un autre coup ouvre une variante.
    harness.key_press(egui::Key::Home);
    settle(&mut harness);
    harness.get_by_label("Explorer des variantes").click();
    settle(&mut harness);
    play(&mut harness, &["e4"]);
    harness.get_by_label("Demi-coup 1 sur 33");
    play(&mut harness, &["c5"]);
    harness.get_by_label("Variante : demi-coup 1 sur 1");
    wait_label(&mut harness, "Évaluation : ");
    play(&mut harness, &["bonjour"]);
    harness.get_by_label_contains("Coup impossible dans cette position : « bonjour »");

    // Échap revient à la partie.
    harness.get_by_label("Retour à la liste"); // la page est toujours là
    harness.key_press(egui::Key::Escape);
    settle(&mut harness);
    harness.get_by_label("Demi-coup 1 sur 33");
}

#[test]
fn promotion_et_debut_fin_dans_la_variante() {
    let Some(mut harness) = harness() else { return };
    harness.get_by_label("Explorer des variantes").click();
    settle(&mut harness);
    play(&mut harness, &["d4", "d5", "c4", "e6"]);
    // Variante qui mène à une promotion : 1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7.
    harness.key_press(egui::Key::Escape);
    settle(&mut harness);
    harness.key_press(egui::Key::Home);
    settle(&mut harness);
    play(&mut harness, &["d4"]);
    harness.get_by_label("Variante : demi-coup 1 sur 1");
    harness.key_press(egui::Key::Escape);
    settle(&mut harness);
    harness.key_press(egui::Key::Home);
    settle(&mut harness);
    play(
        &mut harness,
        &["e4", "d5", "exd5", "c6", "dxc6", "Cf6", "cxb7", "Cbd7"],
    );
    harness.get_by_label("Variante : demi-coup 7 sur 7");

    // Pion b7 prend en c8 à la souris : la pièce est demandée avant de jouer.
    click_at(&harness, square_center(&harness, "b7"));
    settle(&mut harness);
    click_at(&harness, square_center(&harness, "c8"));
    settle(&mut harness);
    harness.get_by_label("Cavalier").click();
    settle(&mut harness);
    harness.get_by_label("Variante : demi-coup 8 sur 8");
    assert!(
        harness
            .query_all_by_label_contains("bxc8=N")
            .next()
            .is_some()
    );

    harness.get_by_label("Début").click();
    settle(&mut harness);
    harness.get_by_label("Variante : demi-coup 0 sur 8");
    harness.get_by_label("Fin").click();
    settle(&mut harness);
    harness.get_by_label("Variante : demi-coup 8 sur 8");
}
