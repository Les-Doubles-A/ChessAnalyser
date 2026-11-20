//! Écran d'analyse (E3) : échiquier, navigation, analyse moteur, courbe, coup courant,
//! synthèse, liste des coups et variantes.

use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use eframe::egui::{self, Color32, Frame, Key, Margin, RichText, Stroke};
use shakmaty::{Role, Square};

use super::board::{self, BoardState, BoardView};
use super::{Shared, theme};
use crate::analysis::{
    Category, EloEstimate, GameReport, GameSynthesis, MoveAnalysis, build_report, estimate_elo,
    format_score, player_features, summarize_game,
};
use crate::chess::{
    Color as Side, ExploreState, MoveInput, ParsedGame, Ply, current_fen, current_ply, format_line,
    is_promotion, move_label, parse_game, play_move, pv_to_san, step_back, uci_to_san,
};
use crate::chesscom::{GameSummary, PlayerSide, perspective, time_class_label};
use crate::engine::{Event, PositionEval, Preset, Request};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, PartialEq)]
enum Status {
    Running,
    Done,
    Cancelled,
    Error(String),
}

/// Analyse en cours ou dernière lancée.
struct Run {
    id: u64,
    status: Status,
    preset: Preset,
    /// Préréglage des évaluations affichées, None tant qu'aucune analyse n'est complète.
    shown: Option<Preset>,
    /// Évaluations affichées.
    evals: Vec<Option<PositionEval>>,
    pending: Vec<Option<PositionEval>>,
    /// Vrai pendant une relance : les dernières évaluations complètes restent affichées.
    keep: bool,
    done: usize,
    cancel: Arc<AtomicBool>,
    /// Change à chaque modification de `evals` (rapport et synthèse à recalculer).
    version: u64,
}

struct Derived {
    version: u64,
    report: GameReport,
    synthesis: GameSynthesis,
    elo: [Option<EloEstimate>; 2],
    known: HashMap<String, PositionEval>,
}

pub struct AnalysisView {
    game: GameSummary,
    username: String,
    parsed: Option<ParsedGame>,
    nav: ExploreState,
    exploring: bool,
    board: BoardState,
    move_text: String,
    move_message: String,
    focus_move_field: bool,
    promotion: Option<(String, Square, Square)>,
    run: Run,
    derived: Option<Derived>,
    variation_cache: HashMap<(u32, String), PositionEval>,
    variation_error: Option<(u32, Vec<String>, String)>,
    variation_request: (u32, Vec<String>),
    /// Dernier coup amené à l'écran dans la liste des coups.
    scrolled_to: Option<usize>,
}

impl AnalysisView {
    pub fn new(
        game: GameSummary,
        username: String,
        preset: Preset,
        shared: &Shared,
    ) -> AnalysisView {
        let parsed = parse_game(&game.pgn).ok();
        let total = parsed.as_ref().map_or(0, |p| p.plies.len() + 1);
        let mut view = AnalysisView {
            game,
            username,
            parsed,
            nav: ExploreState::default(),
            exploring: false,
            board: BoardState::default(),
            move_text: String::new(),
            move_message: String::new(),
            focus_move_field: false,
            promotion: None,
            run: Run {
                id: 0,
                status: Status::Running,
                preset,
                shown: None,
                evals: vec![None; total],
                pending: vec![None; total],
                keep: false,
                done: 0,
                cancel: Arc::new(AtomicBool::new(false)),
                version: 0,
            },
            derived: None,
            variation_cache: HashMap::new(),
            variation_error: None,
            variation_request: (0, Vec::new()),
            scrolled_to: None,
        };
        if view.parsed.is_some() {
            view.start(preset, shared);
        }
        view
    }

    pub fn finished(&self) -> bool {
        self.run.status != Status::Running
    }

    fn start(&mut self, preset: Preset, shared: &Shared) {
        let Some(parsed) = &self.parsed else { return };
        self.run.cancel.store(true, Ordering::Relaxed);
        let cancel = Arc::new(AtomicBool::new(false));
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let total = parsed.plies.len() + 1;
        self.run.id = id;
        self.run.status = Status::Running;
        self.run.preset = preset;
        self.run.keep = self.run.shown.is_some();
        self.run.pending = vec![None; total];
        self.run.done = 0;
        self.run.cancel = cancel.clone();
        shared.engine.send(Request::Analyse {
            id,
            fens: parsed.fens(),
            depth: preset.depth(),
            cancel,
        });
    }

    fn cancel(&mut self) {
        self.run.cancel.store(true, Ordering::Relaxed);
    }

    /// Quitte l'écran : l'analyse et les évaluations de variante en attente sont abandonnées.
    pub fn close(self, shared: &Shared) {
        self.run.cancel.store(true, Ordering::Relaxed);
        shared.engine.send(Request::Variation {
            fens: Vec::new(),
            depth: 0,
        });
    }

    fn handle_engine_events(&mut self, shared: &Shared) {
        while let Ok(event) = shared.engine.events.try_recv() {
            match event {
                Event::Position { id, index, eval } if id == self.run.id => {
                    if let Some(slot) = self.run.pending.get_mut(index) {
                        *slot = Some(eval);
                    }
                    self.run.done = self.run.pending.iter().filter(|e| e.is_some()).count();
                    if !self.run.keep {
                        self.run.evals = self.run.pending.clone();
                        self.run.version += 1;
                    }
                }
                Event::Finished { id, complete } if id == self.run.id => {
                    if complete {
                        self.run.evals = self.run.pending.clone();
                        self.run.shown = Some(self.run.preset);
                        self.run.status = Status::Done;
                        self.run.version += 1;
                    } else {
                        self.run.status = Status::Cancelled;
                    }
                }
                Event::Failed { id, error } if id == self.run.id => {
                    self.run.status = Status::Error(match error {
                        crate::engine::EngineError::Timeout
                        | crate::engine::EngineError::Crashed(_) => {
                            "L’analyse a échoué. Les évaluations obtenues restent affichées.".into()
                        }
                        other => other.to_string(),
                    });
                }
                Event::VariationEval { depth, eval } => {
                    self.variation_cache.insert((depth, eval.fen.clone()), eval);
                }
                Event::VariationFailed { depth, .. } => {
                    let (_, fens) = self.variation_request.clone();
                    self.variation_error =
                        Some((depth, fens, "La variante n’a pas pu être évaluée.".into()));
                    self.variation_request = (0, Vec::new());
                }
                _ => {}
            }
        }
    }

    fn derived(&mut self, shared: &Shared) -> &Derived {
        let parsed = self.parsed.as_ref().expect("partie lue");
        let stale = self
            .derived
            .as_ref()
            .is_none_or(|d| d.version != self.run.version);
        if stale {
            let report = build_report(parsed, &self.run.evals, Some(&shared.openings));
            let synthesis = summarize_game(parsed, &report, &shared.openings);
            // Modèle Elo du préréglage des évaluations affichées.
            let preset = self.run.shown.unwrap_or(self.run.preset);
            let model = shared.elo_model.presets.get(preset.code());
            let elo = [Side::White, Side::Black].map(|side| {
                estimate_elo(
                    player_features(&report, side).as_ref(),
                    &self.game.time_class,
                    model,
                )
            });
            let known = self
                .run
                .evals
                .iter()
                .flatten()
                .map(|e| (e.fen.clone(), e.clone()))
                .collect();
            self.derived = Some(Derived {
                version: self.run.version,
                report,
                synthesis,
                elo,
                known,
            });
        }
        self.derived.as_ref().expect("calculé")
    }

    fn go(&mut self, target: usize) {
        let last = self.parsed.as_ref().map_or(0, |p| p.plies.len());
        self.nav = ExploreState {
            position: target.min(last),
            variation: None,
            cursor: 0,
        };
    }

    fn play(&mut self, input: MoveInput) -> bool {
        let Some(parsed) = &self.parsed else {
            return false;
        };
        match play_move(parsed, &self.nav, &input) {
            Some(next) => {
                self.nav = next;
                true
            }
            None => false,
        }
    }

    fn handle_keys(&mut self, ctx: &egui::Context) {
        if ctx.egui_wants_keyboard_input() {
            return;
        }
        let last = self.parsed.as_ref().map_or(0, |p| p.plies.len());
        let (left, right, home, end, escape) = ctx.input(|i| {
            (
                i.key_pressed(Key::ArrowLeft),
                i.key_pressed(Key::ArrowRight),
                i.key_pressed(Key::Home),
                i.key_pressed(Key::End),
                i.key_pressed(Key::Escape),
            )
        });
        if escape {
            self.nav.variation = None;
            self.nav.cursor = 0;
        }
        // Flèches, Début et Fin parcourent la variante si elle est affichée, sinon la partie.
        let (value, end_value) = match &self.nav.variation {
            Some(v) => (self.nav.cursor, v.plies.len()),
            None => (self.nav.position, last),
        };
        let target = if left {
            Some(value.saturating_sub(1))
        } else if right {
            Some((value + 1).min(end_value))
        } else if home {
            Some(0)
        } else if end {
            Some(end_value)
        } else {
            None
        };
        if let Some(target) = target {
            if self.nav.variation.is_some() {
                self.nav.cursor = target;
            } else {
                self.nav.position = target;
            }
        }
    }

    /// Affiche l'écran ; vrai si l'utilisateur demande le retour à la liste.
    pub fn show(&mut self, ui: &mut egui::Ui, shared: &Shared) -> bool {
        self.handle_engine_events(shared);
        let dark = ui.visuals().dark_mode;
        let view = perspective(&self.game, &self.username);
        let flipped = view.is_black;
        let outcome = view.outcome;
        let me = view.me.username.clone();

        let mut back = false;
        ui.horizontal(|ui| {
            back = ui.button("Retour à la liste").clicked();
            ui.heading(format!(
                "{} contre {}",
                self.game.white.username, self.game.black.username
            ));
        });
        ui.label(
            RichText::new(format!(
                "{} · {} · {} pour {me}",
                theme::format_date(self.game.end_time),
                time_class_label(&self.game.time_class),
                outcome.label()
            ))
            .color(theme::muted(dark)),
        );
        if self.parsed.is_none() {
            ui.colored_label(
                theme::error_color(dark),
                "Cette partie n’a pas pu être lue.",
            );
            return back;
        }
        self.handle_keys(ui.ctx());
        self.request_variation_evals(shared);
        ui.add_space(6.0);

        let wide = ui.available_width() >= 960.0;
        if wide {
            let board_size = (ui.available_height() - 190.0)
                .min(ui.available_width() * 0.52)
                .clamp(300.0, 680.0);
            ui.horizontal_top(|ui| {
                ui.vertical(|ui| {
                    ui.set_width(board_size + 40.0);
                    self.board_column(ui, shared, board_size, flipped);
                });
                ui.add_space(16.0);
                ui.vertical(|ui| {
                    egui::ScrollArea::vertical()
                        .id_salt("colonne")
                        .auto_shrink(false)
                        .show(ui, |ui| {
                            self.side_column(ui, shared);
                        });
                });
            });
        } else {
            egui::ScrollArea::vertical()
                .id_salt("tout")
                .auto_shrink(false)
                .show(ui, |ui| {
                    let board_size = (ui.available_width() - 40.0).clamp(240.0, 640.0);
                    self.board_column(ui, shared, board_size, flipped);
                    ui.add_space(12.0);
                    self.side_column(ui, shared);
                });
        }
        back
    }

    fn variation_fens(&self) -> Option<Vec<String>> {
        self.nav.variation.as_ref().map(|v| v.fens())
    }

    fn variation_depth(&self) -> u32 {
        self.run.shown.unwrap_or(self.run.preset).depth()
    }

    fn variation_eval(
        &self,
        shared_known: &HashMap<String, PositionEval>,
        fen: &str,
    ) -> Option<PositionEval> {
        shared_known.get(fen).cloned().or_else(|| {
            self.variation_cache
                .get(&(self.variation_depth(), fen.to_string()))
                .cloned()
        })
    }

    /// Demande au moteur les positions de la variante qui ne sont pas encore évaluées, la
    /// position affichée d'abord.
    fn request_variation_evals(&mut self, shared: &Shared) {
        let depth = self.variation_depth();
        let fens = self.variation_fens().unwrap_or_default();
        if self
            .variation_error
            .as_ref()
            .is_some_and(|(d, f, _)| *d == depth && *f == fens)
        {
            return; // déjà en échec pour cette variante : pas de nouvelle tentative automatique
        }
        let cursor = self.nav.cursor.min(fens.len().saturating_sub(1));
        let known_fens: Vec<String> = {
            let known = &self.derived(shared).known;
            let mut ordered: Vec<String> = fens
                .get(cursor)
                .cloned()
                .into_iter()
                .chain(fens.iter().cloned())
                .collect();
            let mut seen = std::collections::HashSet::new();
            ordered.retain(|fen| seen.insert(fen.clone()));
            ordered.retain(|fen| !known.contains_key(fen));
            ordered
        };
        let missing: Vec<String> = known_fens
            .into_iter()
            .filter(|fen| !self.variation_cache.contains_key(&(depth, fen.clone())))
            .collect();
        let request = (depth, missing);
        if request != self.variation_request {
            self.variation_request = request.clone();
            self.variation_error = None;
            shared.engine.send(Request::Variation {
                fens: request.1,
                depth: request.0,
            });
        }
    }

    fn board_column(&mut self, ui: &mut egui::Ui, shared: &Shared, size: f32, flipped: bool) {
        let dark = ui.visuals().dark_mode;
        let parsed = self.parsed.clone().expect("partie lue");
        let fen = current_fen(&parsed, &self.nav);
        let last = parsed.plies.len();
        let variation_fens = self.variation_fens();
        let derived_known = self.derived(shared).known.clone();
        let shown_eval = match (&self.nav.variation, &variation_fens) {
            (Some(_), Some(fens)) => fens
                .get(self.nav.cursor)
                .and_then(|f| self.variation_eval(&derived_known, f)),
            _ => self.run.evals.get(self.nav.position).cloned().flatten(),
        };

        // Flèche : meilleur coup sur les erreurs (partie), coup conseillé (variante).
        let shown = self
            .nav
            .variation
            .as_ref()
            .map_or(self.nav.position, |v| v.base);
        let arrows = if self.nav.variation.is_some() {
            shown_eval
                .as_ref()
                .and_then(|e| e.best_move_uci.clone())
                .filter(|uci| uci_to_san(&fen, uci).is_some())
                .and_then(|uci| uci_squares(&uci))
                .into_iter()
                .collect()
        } else {
            let analysis = shown
                .checked_sub(1)
                .and_then(|i| self.derived(shared).report.moves.get(i).cloned().flatten());
            analysis
                .filter(|m| m.category.is_error())
                .and_then(|m| m.best_move_uci)
                .and_then(|uci| uci_squares(&uci))
                .into_iter()
                .collect()
        };

        let (top, bottom) = if flipped {
            (self.game.white.clone(), self.game.black.clone())
        } else {
            (self.game.black.clone(), self.game.white.clone())
        };
        player_tag(ui, &top, dark);
        let last_move = current_ply(&parsed, &self.nav).map(|p| (p.from, p.to));
        let requested = ui
            .horizontal(|ui| {
                board::eval_bar(ui, shown_eval.as_ref().map(|e| &e.score), flipped, size);
                board::board(
                    ui,
                    &mut self.board,
                    &BoardView {
                        fen: &fen,
                        flipped,
                        last_move,
                        arrows,
                        interactive: self.exploring,
                        size,
                    },
                )
            })
            .inner;
        if let Some((from, to)) = requested {
            if is_promotion(&fen, from, to) {
                self.promotion = Some((fen.clone(), from, to));
            } else {
                self.promotion = None;
                self.play(MoveInput::Squares {
                    from,
                    to,
                    promotion: None,
                });
            }
        }
        player_tag(ui, &bottom, dark);

        ui.horizontal(|ui| {
            let in_variation = self.nav.variation.as_ref().map(|v| v.plies.len());
            if ui.button("Début").clicked() {
                if in_variation.is_some() {
                    self.nav.cursor = 0
                } else {
                    self.go(0)
                }
            }
            if ui.button("Précédent").clicked() {
                if in_variation.is_some() {
                    self.nav.cursor = self.nav.cursor.saturating_sub(1)
                } else {
                    self.go(self.nav.position.saturating_sub(1))
                }
            }
            if ui.button("Suivant").clicked() {
                match in_variation {
                    Some(len) => self.nav.cursor = (self.nav.cursor + 1).min(len),
                    None => self.go(self.nav.position + 1),
                }
            }
            if ui.button("Fin").clicked() {
                match in_variation {
                    Some(len) => self.nav.cursor = len,
                    None => self.go(last),
                }
            }
        });
        let indicator = match &self.nav.variation {
            Some(v) => format!(
                "Variante : demi-coup {} sur {}",
                self.nav.cursor,
                v.plies.len()
            ),
            None if self.nav.position == 0 => "Position de départ".into(),
            None => format!("Demi-coup {} sur {last}", self.nav.position),
        };
        ui.label(RichText::new(indicator).color(theme::muted(dark)));

        if ui
            .selectable_label(self.exploring, "Explorer des variantes")
            .clicked()
        {
            self.exploring = !self.exploring;
            self.focus_move_field = self.exploring;
        }
        if self.exploring {
            self.explore_bar(ui, &fen, shown_eval.as_ref(), dark);
        }
        if let Some((pfen, from, to)) = self.promotion.clone()
            && pfen == fen
            && self.exploring
        {
            ui.horizontal(|ui| {
                ui.label("Promotion :");
                for (role, label) in [
                    (Role::Queen, "Dame"),
                    (Role::Rook, "Tour"),
                    (Role::Bishop, "Fou"),
                    (Role::Knight, "Cavalier"),
                ] {
                    if ui.button(label).clicked() {
                        self.promotion = None;
                        self.play(MoveInput::Squares {
                            from,
                            to,
                            promotion: Some(role),
                        });
                    }
                }
                if ui.button("Annuler").clicked() {
                    self.promotion = None;
                }
            });
        }
    }

    fn explore_bar(
        &mut self,
        ui: &mut egui::Ui,
        fen: &str,
        shown_eval: Option<&PositionEval>,
        dark: bool,
    ) {
        let best = shown_eval
            .and_then(|e| e.best_move_uci.clone())
            .filter(|uci| uci_to_san(fen, uci).is_some());
        let best_san = best.as_deref().and_then(|uci| uci_to_san(fen, uci));
        let mut submit = false;
        ui.horizontal(|ui| {
            let label = ui.label("Jouer un coup");
            let response = ui
                .add(
                    egui::TextEdit::singleline(&mut self.move_text)
                        .desired_width(90.0)
                        .id_salt("coup"),
                )
                .labelled_by(label.id);
            if self.focus_move_field {
                response.request_focus();
                self.focus_move_field = false;
            }
            if response.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter)) {
                submit = true;
                response.request_focus();
            }
            submit |= ui.button("Jouer").clicked();
            let label = match &best_san {
                Some(san) => format!("Coup du moteur ({san})"),
                None => "Coup du moteur".into(),
            };
            if ui
                .add_enabled(best.is_some(), egui::Button::new(label))
                .clicked()
                && let Some(uci) = best.clone()
            {
                self.play(MoveInput::Text(uci));
            }
        });
        if submit {
            let text = self.move_text.trim().to_string();
            if !text.is_empty() {
                if self.play(MoveInput::Text(text.clone())) {
                    self.move_text.clear();
                    self.move_message.clear();
                } else {
                    self.move_message =
                        format!("Coup impossible dans cette position : « {text} ».");
                }
            }
        }
        ui.label(
            RichText::new(
                "Glisser une pièce sur l’échiquier, ou saisir le coup : Nf3, Cf3 ou g1f3.",
            )
            .color(theme::muted(dark))
            .small(),
        );
        if !self.move_message.is_empty() {
            ui.colored_label(theme::error_color(dark), &self.move_message);
        }
    }

    fn side_column(&mut self, ui: &mut egui::Ui, shared: &Shared) {
        let dark = ui.visuals().dark_mode;
        self.controls(ui, shared, dark);
        ui.add_space(6.0);

        let parsed = self.parsed.clone().expect("partie lue");
        let total = parsed.plies.len() + 1;
        let shown = self
            .nav
            .variation
            .as_ref()
            .map_or(self.nav.position, |v| v.base);
        let width = ui.available_width().min(640.0);
        let moves = self.derived(shared).report.moves.clone();
        if let Some(target) = board::eval_graph(ui, &self.run.evals, &moves, total, shown, width) {
            self.go(target);
        }
        ui.add_space(6.0);

        if self.nav.variation.is_some() {
            self.variation_panel(ui, shared, &parsed, dark);
            ui.add_space(6.0);
        }
        self.move_panel(ui, shared, &parsed, dark);
        ui.add_space(6.0);

        let derived = self.derived(shared);
        let partial = if derived.report.complete {
            ""
        } else {
            " (partielle)"
        };
        ui.label(format!(
            "Précision{partial} : Blancs {} · Noirs {}",
            theme::format_accuracy(derived.report.accuracy.white),
            theme::format_accuracy(derived.report.accuracy.black)
        ));
        ui.add_space(6.0);
        if let Some(target) = self.summary(ui, shared, &parsed, dark) {
            self.go(target);
        }
        ui.add_space(6.0);
        if let Some(target) = self.move_list(ui, shared, &parsed, shown, dark) {
            self.go(target);
        }
    }

    fn controls(&mut self, ui: &mut egui::Ui, shared: &Shared, dark: bool) {
        let total = self.run.pending.len();
        match self.run.status.clone() {
            Status::Running => {
                let deep = if self.run.preset == Preset::Deep {
                    "profonde "
                } else {
                    ""
                };
                ui.horizontal(|ui| {
                    ui.label(format!(
                        "Analyse {deep}: {} / {total} positions",
                        self.run.done
                    ));
                    if ui.button("Annuler").clicked() {
                        self.cancel();
                    }
                });
                ui.add(
                    egui::ProgressBar::new(self.run.done as f32 / total.max(1) as f32)
                        .desired_width(320.0),
                );
            }
            Status::Error(message) => {
                ui.colored_label(theme::error_color(dark), message);
                if ui.button("Réessayer").clicked() {
                    self.start(self.run.preset, shared);
                }
            }
            status => {
                ui.horizontal(|ui| {
                    let text = match (status, self.run.shown) {
                        (Status::Cancelled, Some(shown)) => format!(
                            "Analyse {} annulée ; résultats {} conservés.",
                            self.run.preset.label(),
                            shown.label()
                        ),
                        (Status::Cancelled, None) => "Analyse incomplète.".into(),
                        (_, shown) => {
                            let preset = shown.unwrap_or(self.run.preset);
                            format!(
                                "Analyse terminée ({}, profondeur {}).",
                                preset.label(),
                                preset.depth()
                            )
                        }
                    };
                    ui.label(text);
                    if self.run.status == Status::Cancelled
                        && self.run.shown.is_none()
                        && ui.button("Relancer l’analyse").clicked()
                    {
                        self.start(self.run.preset, shared);
                    }
                    if self.run.shown != Some(Preset::Deep)
                        && (self.run.shown.is_some() || self.run.status == Status::Done)
                        && ui.button("Analyse profonde").clicked()
                    {
                        self.start(Preset::Deep, shared);
                    }
                });
            }
        }
    }

    fn move_panel(&mut self, ui: &mut egui::Ui, shared: &Shared, parsed: &ParsedGame, dark: bool) {
        let derived_known = self.derived(shared).known.clone();
        let in_variation_move = self.nav.variation.is_some() && self.nav.cursor > 0;
        let (ply, analysis, before, after): (
            Option<Ply>,
            Option<MoveAnalysis>,
            Option<PositionEval>,
            Option<PositionEval>,
        ) = if in_variation_move {
            let v = self.nav.variation.clone().expect("variante");
            let evals: Vec<Option<PositionEval>> = v
                .fens()
                .iter()
                .map(|f| self.variation_eval(&derived_known, f))
                .collect();
            let moves = build_report(&v.as_game(), &evals, None).moves;
            let c = self.nav.cursor;
            (
                v.plies.get(c - 1).cloned(),
                moves.get(c - 1).cloned().flatten(),
                evals[c - 1].clone(),
                evals[c].clone(),
            )
        } else {
            let shown = self
                .nav
                .variation
                .as_ref()
                .map_or(self.nav.position, |v| v.base);
            if shown == 0 {
                (None, None, None, None)
            } else {
                (
                    parsed.plies.get(shown - 1).cloned(),
                    self.derived(shared)
                        .report
                        .moves
                        .get(shown - 1)
                        .cloned()
                        .flatten(),
                    self.run.evals.get(shown - 1).cloned().flatten(),
                    self.run.evals.get(shown).cloned().flatten(),
                )
            }
        };

        let stroke_color = analysis.as_ref().map_or(theme::muted(dark), |a| {
            theme::category_color(a.category, dark)
        });
        let mut try_best = false;
        Frame::group(ui.style())
            .stroke(Stroke::new(1.0, stroke_color))
            .inner_margin(Margin::same(10))
            .show(ui, |ui| {
                ui.set_width(ui.available_width().min(620.0));
                let Some(ply) = &ply else {
                    ui.strong("Position de départ");
                    return;
                };
                let (Some(analysis), Some(before), Some(after)) = (&analysis, &before, &after)
                else {
                    ui.strong(move_label(ply));
                    ui.label(RichText::new("Coup non analysé.").color(theme::muted(dark)));
                    return;
                };
                let color = theme::category_color(analysis.category, dark);
                ui.horizontal(|ui| {
                    let symbol = analysis.category.symbol();
                    let badge = if symbol.is_empty() {
                        analysis.category.label().to_string()
                    } else {
                        format!("{symbol} {}", analysis.category.label())
                    };
                    ui.label(RichText::new(badge).color(color).strong());
                    ui.strong(move_label(ply));
                });
                if analysis.category.is_error()
                    && let Some(best) = &analysis.best_move_san
                {
                    ui.horizontal(|ui| {
                        ui.label("Meilleur coup :");
                        ui.strong(best);
                        try_best = ui.button(format!("Essayer {best}")).clicked();
                    });
                }
                ui.label(
                    RichText::new(format!(
                        "Évaluation avant : {} · après : {}",
                        format_score(&before.score),
                        format_score(&after.score)
                    ))
                    .color(theme::muted(dark)),
                );
            });

        // Remplace le coup affiché par le meilleur coup du moteur, dans une variante.
        if try_best && let Some(best) = analysis.and_then(|a| a.best_move_uci) {
            let back = if in_variation_move {
                step_back(&self.nav)
            } else {
                let shown = self
                    .nav
                    .variation
                    .as_ref()
                    .map_or(self.nav.position, |v| v.base);
                ExploreState {
                    position: shown.saturating_sub(1),
                    variation: None,
                    cursor: 0,
                }
            };
            if let Some(next) = play_move(parsed, &back, &MoveInput::Text(best)) {
                self.nav = next;
                self.exploring = true;
            }
        }
    }

    fn variation_panel(
        &mut self,
        ui: &mut egui::Ui,
        shared: &Shared,
        parsed: &ParsedGame,
        dark: bool,
    ) {
        let Some(v) = self.nav.variation.clone() else {
            return;
        };
        let known = self.derived(shared).known.clone();
        let evals: Vec<Option<PositionEval>> = v
            .fens()
            .iter()
            .map(|f| self.variation_eval(&known, f))
            .collect();
        let moves = build_report(&v.as_game(), &evals, None).moves;
        let current = evals.get(self.nav.cursor).cloned().flatten();
        let fen = v.fens()[self.nav.cursor].clone();
        let mut select = None;
        let mut exit = false;
        Frame::group(ui.style())
            .inner_margin(Margin::same(10))
            .show(ui, |ui| {
                ui.set_width(ui.available_width().min(620.0));
                let from = v.base.checked_sub(1).and_then(|i| parsed.plies.get(i));
                ui.strong(match from {
                    Some(ply) => format!("Variante après {}", move_label(ply)),
                    None => "Variante depuis la position de départ".into(),
                });
                ui.horizontal_wrapped(|ui| {
                    if ui
                        .selectable_label(self.nav.cursor == 0, "Départ")
                        .clicked()
                    {
                        select = Some(0);
                    }
                    for (i, ply) in v.plies.iter().enumerate() {
                        let analysis = moves.get(i).cloned().flatten();
                        let text = match &analysis {
                            Some(a) => RichText::new(with_symbol(&move_label(ply), a.category))
                                .color(theme::category_color(a.category, dark)),
                            None => RichText::new(move_label(ply)),
                        };
                        if ui
                            .selectable_label(self.nav.cursor == i + 1, text)
                            .clicked()
                        {
                            select = Some(i + 1);
                        }
                    }
                });
                let error = self
                    .variation_error
                    .as_ref()
                    .filter(|(d, f, _)| *d == self.variation_depth() && *f == v.fens())
                    .map(|(_, _, m)| m.clone());
                let text = match (error, &current) {
                    (Some(message), _) => message,
                    (None, Some(eval)) => {
                        let line = if eval.pv.is_empty() {
                            String::new()
                        } else {
                            format_line(&fen, &pv_to_san(&fen, &eval.pv, 8))
                        };
                        if line.is_empty() {
                            format!("Évaluation : {}", format_score(&eval.score))
                        } else {
                            format!(
                                "Évaluation : {} · Suite du moteur : {line}",
                                format_score(&eval.score)
                            )
                        }
                    }
                    (None, None) => "Évaluation en cours…".into(),
                };
                ui.label(text);
                exit = ui.button("Revenir à la partie").clicked();
            });
        if let Some(cursor) = select {
            self.nav.cursor = cursor;
        }
        if exit {
            self.nav.variation = None;
            self.nav.cursor = 0;
        }
    }

    fn summary(
        &mut self,
        ui: &mut egui::Ui,
        shared: &Shared,
        parsed: &ParsedGame,
        dark: bool,
    ) -> Option<usize> {
        let pending = self.run.status == Status::Running && !self.derived(shared).report.complete;
        let url = self.game.url.clone();
        let (white, black) = (self.game.white.clone(), self.game.black.clone());
        let model_missing = self
            .derived(shared)
            .elo
            .iter()
            .any(|e| matches!(e, Some(EloEstimate::Unavailable)));
        let derived = self.derived(shared);
        let mut chosen = None;
        Frame::group(ui.style())
            .inner_margin(Margin::same(10))
            .show(ui, |ui| {
                ui.set_width(ui.available_width().min(620.0));
                ui.heading("Synthèse");
                if pending {
                    ui.label(
                        RichText::new("Disponible à la fin de l’analyse").color(theme::muted(dark)),
                    );
                    ui.hyperlink_to("Voir sur chess.com", &url);
                    return;
                }
                if !derived.report.complete {
                    ui.label("Analyse incomplète : synthèse partielle");
                }
                ui.strong("Niveau joué");
                for (i, (side, player)) in [("Blancs", &white), ("Noirs", &black)]
                    .into_iter()
                    .enumerate()
                {
                    ui.horizontal_wrapped(|ui| {
                        ui.strong(format!("{side}, {} :", player.username));
                        ui.label(elo_text(derived.elo[i].as_ref()));
                        ui.label(
                            RichText::new(format!("· classement chess.com {}", player.rating))
                                .color(theme::muted(dark)),
                        );
                    });
                }
                if model_missing {
                    ui.label(
                        RichText::new(
                            "Le modèle d’estimation n’est calibré que pour l’analyse Standard.",
                        )
                        .color(theme::muted(dark))
                        .small(),
                    );
                }
                ui.add_space(4.0);
                let opening = match &derived.synthesis.opening {
                    Some(o) => format!("{} · {}", o.eco, o.name),
                    None => "Ouverture non répertoriée".into(),
                };
                ui.label(format!("Ouverture : {opening}"));
                ui.add_space(4.0);
                egui::Grid::new("compteurs")
                    .striped(true)
                    .spacing([24.0, 2.0])
                    .show(ui, |ui| {
                        ui.strong("Catégorie");
                        ui.strong("Blancs");
                        ui.strong("Noirs");
                        ui.end_row();
                        for category in Category::ALL {
                            let symbol = category.symbol();
                            let label = if symbol.is_empty() {
                                category.label().to_string()
                            } else {
                                format!("{symbol} {}", category.label())
                            };
                            ui.label(
                                RichText::new(label).color(theme::category_color(category, dark)),
                            );
                            ui.label(derived.synthesis.white.get(category).to_string());
                            ui.label(derived.synthesis.black.get(category).to_string());
                            ui.end_row();
                        }
                        let unanalysed = (
                            derived.synthesis.white.unanalysed,
                            derived.synthesis.black.unanalysed,
                        );
                        if unanalysed.0 + unanalysed.1 > 0 {
                            ui.label("Non analysé");
                            ui.label(unanalysed.0.to_string());
                            ui.label(unanalysed.1.to_string());
                            ui.end_row();
                        }
                    });
                ui.add_space(4.0);
                ui.strong("Moments clés");
                if derived.synthesis.key_moments.is_empty() {
                    ui.label(RichText::new("Aucune erreur majeure").color(theme::muted(dark)));
                }
                for moment in &derived.synthesis.key_moments {
                    let ply = &parsed.plies[moment.ply_index - 1];
                    let best = moment
                        .best_move_san
                        .as_ref()
                        .map(|b| format!(" · meilleur : {b}"))
                        .unwrap_or_default();
                    let text = RichText::new(format!(
                        "{} {}{best}",
                        with_symbol(&move_label(ply), moment.category),
                        moment.category.label()
                    ))
                    .color(theme::category_color(moment.category, dark));
                    if ui.button(text).clicked() {
                        chosen = Some(moment.ply_index);
                    }
                }
                ui.add_space(4.0);
                ui.hyperlink_to("Voir sur chess.com", &url);
            });
        chosen
    }

    fn move_list(
        &mut self,
        ui: &mut egui::Ui,
        shared: &Shared,
        parsed: &ParsedGame,
        shown: usize,
        dark: bool,
    ) -> Option<usize> {
        let moves = self.derived(shared).report.moves.clone();
        let mut chosen = None;
        let current_fill = theme::current_move_fill(dark);
        Frame::group(ui.style())
            .inner_margin(Margin::same(8))
            .show(ui, |ui| {
                ui.set_width(ui.available_width().min(620.0));
                egui::ScrollArea::vertical()
                    .id_salt("coups")
                    .max_height(360.0)
                    .show(ui, |ui| {
                        egui::Grid::new("liste-coups")
                            .spacing([12.0, 2.0])
                            .min_col_width(40.0)
                            .show(ui, |ui| {
                                for pair in parsed.plies.chunks(2) {
                                    let first = &pair[0];
                                    ui.label(
                                        RichText::new(format!("{}.", first.move_number))
                                            .color(theme::muted(dark)),
                                    );
                                    // Partie commencée par les noirs : case blanche vide.
                                    if first.color == Side::Black {
                                        ui.label("");
                                    }
                                    for ply in pair {
                                        let analysis = moves.get(ply.index - 1).cloned().flatten();
                                        let text = match &analysis {
                                            Some(a) => {
                                                RichText::new(with_symbol(&ply.san, a.category))
                                                    .color(
                                                        if a.category.is_error()
                                                            || a.category == Category::Best
                                                        {
                                                            theme::category_color(a.category, dark)
                                                        } else {
                                                            ui.visuals().text_color()
                                                        },
                                                    )
                                            }
                                            None => RichText::new(&ply.san),
                                        };
                                        let selected = ply.index == shown;
                                        let button = egui::Button::new(if selected {
                                            text.color(Color32::from_rgb(0x1d, 0x23, 0x2a)).strong()
                                        } else {
                                            text
                                        })
                                        .fill(if selected {
                                            current_fill
                                        } else {
                                            Color32::TRANSPARENT
                                        })
                                        .stroke(Stroke::NONE);
                                        let response = ui.add(button);
                                        // Défile seulement quand le coup courant change, pas à chaque image.
                                        if selected && self.scrolled_to != Some(shown) {
                                            response.scroll_to_me(None);
                                            self.scrolled_to = Some(shown);
                                        }
                                        let tip = analysis.map_or_else(
                                            || "Non analysé".to_string(),
                                            |a| a.category.label().to_string(),
                                        );
                                        if response.on_hover_text(tip).clicked() {
                                            chosen = Some(ply.index);
                                        }
                                    }
                                    ui.end_row();
                                }
                            });
                    });
            });
        chosen
    }
}

/// « Nf3 ! », « Qh4 ?? » ; le coup seul pour les catégories sans symbole.
fn with_symbol(text: &str, category: Category) -> String {
    match category.symbol() {
        "" => text.to_string(),
        symbol => format!("{text} {symbol}"),
    }
}

fn uci_squares(uci: &str) -> Option<(Square, Square)> {
    let from = uci.get(0..2)?.parse().ok()?;
    let to = uci.get(2..4)?.parse().ok()?;
    Some((from, to))
}

fn player_tag(ui: &mut egui::Ui, player: &PlayerSide, dark: bool) {
    ui.horizontal(|ui| {
        ui.strong(&player.username);
        ui.label(RichText::new(format!("({})", player.rating)).color(theme::muted(dark)));
    });
}

fn elo_text(estimate: Option<&EloEstimate>) -> String {
    match estimate {
        None => "Disponible quand l’analyse est complète".into(),
        Some(EloEstimate::TooShort) => "Partie trop courte pour estimer le niveau".into(),
        Some(EloEstimate::Unavailable) => "Estimation non calibrée pour ce préréglage".into(),
        Some(EloEstimate::Estimate {
            value,
            low,
            high,
            confidence,
        }) => {
            // Repli de H7 : quand l'intervalle est large, la fourchette passe avant le chiffre.
            if confidence.label() == "faible" {
                format!("entre {low} et {high} (≈ {value}), confiance faible")
            } else {
                format!(
                    "≈ {value} ({low} à {high}), confiance {}",
                    confidence.label()
                )
            }
        }
    }
}
