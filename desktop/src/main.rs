// Pas de console derrière la fenêtre en version publiée.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Point d'entrée. Options (développement et vérifications) :
//!   --pgn <fichier>         ouvre directement une partie PGN locale, sans chess.com
//!   --search <pseudo>       lance la recherche au démarrage
//!   --screenshot <png>      enregistre une capture une fois la page prête, puis quitte
//!   --size <largeur>x<hauteur>

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use chessanalyser::chesscom::{GameSummary, PlayerSide, count_moves};
use chessanalyser::ui::{ChessApp, FrameHook};
use eframe::egui;

struct Options {
    pgn: Option<PathBuf>,
    search: Option<String>,
    screenshot: Option<PathBuf>,
    size: [f32; 2],
}

fn parse_options() -> Options {
    let mut options = Options {
        pgn: None,
        search: None,
        screenshot: None,
        size: [1280.0, 880.0],
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--pgn" => options.pgn = args.next().map(PathBuf::from),
            "--search" => options.search = args.next(),
            "--screenshot" => options.screenshot = args.next().map(PathBuf::from),
            "--size" => {
                if let Some((w, h)) = args.next().as_deref().and_then(|s| s.split_once('x'))
                    && let (Ok(w), Ok(h)) = (w.parse(), h.parse())
                {
                    options.size = [w, h];
                }
            }
            _ => {}
        }
    }
    options
}

fn local_game(path: &PathBuf) -> Option<GameSummary> {
    let pgn = std::fs::read_to_string(path).ok()?;
    let side = |name: &str| PlayerSide {
        username: name.into(),
        rating: 0,
        result: String::new(),
    };
    Some(GameSummary {
        url: "https://www.chess.com/".into(),
        end_time: 0,
        time_class: "unknown".into(),
        rules: "chess".into(),
        rated: false,
        white: side("Blancs"),
        black: side("Noirs"),
        move_count: count_moves(&pgn),
        pgn,
        supported: true,
    })
}

fn main() -> eframe::Result {
    let options = parse_options();
    let icon = eframe::icon_data::from_png_bytes(include_bytes!("../../public/favicon.png")).ok();
    let mut viewport = egui::ViewportBuilder::default()
        .with_title("ChessAnalyser")
        .with_inner_size(options.size)
        .with_min_inner_size([720.0, 560.0]);
    if let Some(icon) = icon {
        viewport = viewport.with_icon(Arc::new(icon));
    }
    let native = eframe::NativeOptions {
        viewport,
        ..Default::default()
    };

    eframe::run_native(
        "ChessAnalyser",
        native,
        Box::new(move |cc| {
            let mut app = ChessApp::new(cc);
            if let Some(game) = options.pgn.as_ref().and_then(local_game) {
                app.open(game, "Blancs".into());
            }
            if let Some(name) = &options.search {
                app.search(name);
            }
            if let Some(path) = options.screenshot.clone() {
                app.on_frame = Some(screenshot_hook(path, options.pgn.is_some()));
            }
            Ok(Box::new(app))
        }),
    )
}

/// Capture une fois l'analyse terminée (partie locale) ou après 8 s, puis ferme la fenêtre.
fn screenshot_hook(path: PathBuf, wait_analysis: bool) -> FrameHook {
    let started = Instant::now();
    let requested = Arc::new(Mutex::new(false));
    let saved = Arc::new(Mutex::new(false));
    let mut ready_since: Option<Instant> = None;
    Box::new(move |ctx, app| {
        if *saved.lock().expect("verrou") {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        let ready = if wait_analysis {
            app.analysis_finished()
        } else {
            started.elapsed() > Duration::from_secs(8)
        };
        if ready && ready_since.is_none() {
            ready_since = Some(Instant::now());
        }
        // Laisse le temps aux images (pièces SVG) de se charger et à la mise en page de se stabiliser.
        let settled = ready_since.is_some_and(|t| t.elapsed() > Duration::from_millis(800));
        if settled && !*requested.lock().expect("verrou") {
            *requested.lock().expect("verrou") = true;
            let path = path.clone();
            let saved = saved.clone();
            let repaint = ctx.clone();
            ctx.request_screenshot(move |image| {
                let [w, h] = image.size;
                let pixels: Vec<u8> = image.pixels.iter().flat_map(|p| p.to_array()).collect();
                if let Some(buffer) = image::RgbaImage::from_raw(w as u32, h as u32, pixels) {
                    let _ = buffer.save(&path);
                }
                *saved.lock().expect("verrou") = true;
                repaint.request_repaint();
            });
        }
        ctx.request_repaint_after(Duration::from_millis(100));
    })
}
