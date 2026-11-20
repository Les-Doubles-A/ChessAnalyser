//! Interface egui : écran de recherche et liste des parties (E1, E2), écran d'analyse (E3).

mod analysis_view;
pub mod board;
pub mod theme;

use std::sync::Arc;

use eframe::egui::{self, RichText};

use crate::analysis::{EloModel, OpeningIndex};
use crate::chesscom::{
    ApiEvent, ApiRequest, ApiService, ChessComError, GameSummary, perspective, time_class_label,
    validate_username,
};
use crate::engine::{EngineService, Preset, default_engine_path};
use crate::storage::{Prefs, load_prefs, save_prefs};
use analysis_view::AnalysisView;

const UNAVAILABLE: &str = "chess.com ne répond pas.";

enum ListState {
    Idle,
    Loading,
    Error(String),
    Ready {
        username: String,
        archives: Vec<String>,
        /// Index de la plus ancienne archive chargée.
        oldest_index: i64,
        games: Vec<GameSummary>,
        loading_more: bool,
        more_error: Option<String>,
    },
}

/// Ressources partagées par les écrans.
pub struct Shared {
    pub engine: EngineService,
    pub openings: Arc<OpeningIndex>,
    pub elo_model: Arc<EloModel>,
}

pub struct ChessApp {
    shared: Shared,
    api: ApiService,
    query: String,
    preset: Preset,
    form_error: Option<String>,
    focus_query: bool,
    list: ListState,
    filter: &'static str,
    /// Numéro de la recherche en cours : toute réponse antérieure est ignorée.
    generation: u64,
    last_query: String,
    analysis: Option<AnalysisView>,
    /// Ouverture directe d'une partie (option `--pgn`), sans passer par chess.com.
    pub on_frame: Option<FrameHook>,
}

/// Appelé à chaque image (captures d'écran de vérification, option `--screenshot`).
pub type FrameHook = Box<dyn FnMut(&egui::Context, &mut ChessApp)>;

const FILTERS: [&str; 5] = ["all", "bullet", "blitz", "rapid", "daily"];

impl ChessApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> ChessApp {
        egui_extras::install_image_loaders(&cc.egui_ctx);
        theme::install_fonts(&cc.egui_ctx);
        let repaint = cc.egui_ctx.clone();
        let engine = EngineService::spawn(default_engine_path(), move || repaint.request_repaint());
        let repaint = cc.egui_ctx.clone();
        let api = ApiService::spawn(move || repaint.request_repaint());
        let prefs = load_prefs();
        ChessApp {
            shared: Shared {
                engine,
                openings: Arc::new(OpeningIndex::embedded()),
                elo_model: Arc::new(EloModel::embedded()),
            },
            api,
            query: prefs.last_username.unwrap_or_default(),
            preset: prefs.preset.unwrap_or(Preset::Standard),
            form_error: None,
            focus_query: true,
            list: ListState::Idle,
            filter: "all",
            generation: 0,
            last_query: String::new(),
            analysis: None,
            on_frame: None,
        }
    }

    pub fn search(&mut self, raw: &str) {
        match validate_username(raw) {
            Err(message) => {
                self.form_error = Some(message);
                self.focus_query = true;
            }
            Ok(username) => {
                self.generation += 1;
                self.last_query = username.clone();
                self.form_error = None;
                self.list = ListState::Loading;
                self.filter = "all";
                self.api.send(ApiRequest::Search {
                    generation: self.generation,
                    username,
                });
            }
        }
    }

    /// Ouvre une partie dans l'écran d'analyse.
    pub fn open(&mut self, game: GameSummary, username: String) {
        self.analysis = Some(AnalysisView::new(game, username, self.preset, &self.shared));
    }

    pub fn analysis_finished(&self) -> bool {
        self.analysis.as_ref().is_some_and(AnalysisView::finished)
    }

    fn load_previous_month(&mut self) {
        if let ListState::Ready {
            archives,
            oldest_index,
            loading_more,
            more_error,
            ..
        } = &mut self.list
        {
            if *oldest_index <= 0 || *loading_more {
                return;
            }
            let index = (*oldest_index - 1) as usize;
            *loading_more = true;
            *more_error = None;
            self.api.send(ApiRequest::Month {
                generation: self.generation,
                url: archives[index].clone(),
                index,
            });
        }
    }

    fn handle_api_events(&mut self) {
        while let Ok(event) = self.api.events.try_recv() {
            match event {
                ApiEvent::Search {
                    generation,
                    username,
                    result,
                } => {
                    if generation != self.generation {
                        continue;
                    }
                    match result {
                        Ok(latest) => {
                            // Mémorisé seulement une fois le joueur trouvé.
                            save_prefs(Prefs {
                                last_username: Some(username.clone()),
                                preset: None,
                            });
                            self.list = ListState::Ready {
                                username,
                                archives: latest.archives,
                                oldest_index: latest.index,
                                games: latest.games,
                                loading_more: false,
                                more_error: None,
                            };
                        }
                        Err(ChessComError::NotFound) => {
                            self.list = ListState::Idle;
                            self.form_error = Some(format!(
                                "Aucun joueur chess.com ne porte le pseudo « {username} »."
                            ));
                            self.focus_query = true;
                        }
                        Err(_) => self.list = ListState::Error(UNAVAILABLE.into()),
                    }
                }
                ApiEvent::Month {
                    generation,
                    index,
                    result,
                } => {
                    if generation != self.generation {
                        continue;
                    }
                    if let ListState::Ready {
                        oldest_index,
                        games,
                        loading_more,
                        more_error,
                        ..
                    } = &mut self.list
                    {
                        *loading_more = false;
                        match result {
                            Ok(older) => {
                                *oldest_index = index as i64;
                                games.extend(older);
                            }
                            Err(_) => *more_error = Some(UNAVAILABLE.into()),
                        }
                    }
                }
            }
        }
    }

    fn search_screen(&mut self, ui: &mut egui::Ui) {
        let dark = ui.visuals().dark_mode;
        ui.add_space(8.0);
        let pseudo_label = ui.label(RichText::new("Pseudo chess.com").strong());
        let mut submit = false;
        ui.horizontal(|ui| {
            let edit = egui::TextEdit::singleline(&mut self.query)
                .hint_text("ex. : hikaru")
                .desired_width(280.0)
                .id_salt("pseudo");
            let response = ui.add(edit).labelled_by(pseudo_label.id);
            if self.focus_query {
                response.request_focus();
                self.focus_query = false;
            }
            if response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                submit = true;
            }
            let busy = matches!(self.list, ListState::Loading);
            let label = if busy {
                "Recherche…"
            } else {
                "Voir mes parties"
            };
            if ui.add_enabled(!busy, egui::Button::new(label)).clicked() {
                submit = true;
            }
        });
        if let Some(error) = &self.form_error {
            ui.colored_label(theme::error_color(dark), error);
        }
        ui.horizontal(|ui| {
            ui.label("Analyse");
            let before = self.preset;
            egui::ComboBox::from_id_salt("preset")
                .selected_text(preset_option(self.preset))
                .show_ui(ui, |ui| {
                    for preset in [Preset::Standard, Preset::Deep] {
                        ui.selectable_value(&mut self.preset, preset, preset_option(preset));
                    }
                });
            if self.preset != before {
                save_prefs(Prefs {
                    last_username: None,
                    preset: Some(self.preset),
                });
            }
        });
        if submit {
            let query = self.query.clone();
            self.search(&query);
        }
        ui.add_space(12.0);
        self.game_list(ui);
    }

    fn game_list(&mut self, ui: &mut egui::Ui) {
        let dark = ui.visuals().dark_mode;
        let mut open = None;
        let mut retry = false;
        let mut more = false;
        match &self.list {
            ListState::Idle => {}
            ListState::Loading => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label("Chargement des parties…");
                });
            }
            ListState::Error(message) => {
                ui.colored_label(theme::error_color(dark), message);
                retry = ui.button("Réessayer").clicked();
            }
            ListState::Ready {
                username,
                games,
                oldest_index,
                loading_more,
                more_error,
                ..
            } => {
                ui.horizontal(|ui| {
                    ui.heading(format!("Parties de {username}"));
                    if !games.is_empty() {
                        ui.add_space(16.0);
                        ui.label("Cadence");
                        egui::ComboBox::from_id_salt("cadence")
                            .selected_text(filter_label(self.filter))
                            .show_ui(ui, |ui| {
                                for filter in FILTERS {
                                    ui.selectable_value(
                                        &mut self.filter,
                                        filter,
                                        filter_label(filter),
                                    );
                                }
                            });
                    }
                });
                if games.is_empty() {
                    ui.label("Aucune partie publique trouvée.");
                } else {
                    ui.label(
                        RichText::new("Les parties terminées depuis peu peuvent mettre quelques heures à apparaître.")
                            .color(theme::muted(dark)),
                    );
                    let visible: Vec<&GameSummary> = games
                        .iter()
                        .filter(|g| self.filter == "all" || g.time_class == self.filter)
                        .collect();
                    if visible.is_empty() {
                        ui.label("Aucune partie dans cette cadence.");
                    }
                    ui.add_space(4.0);
                    egui::Grid::new("parties")
                        .striped(true)
                        .spacing([18.0, 6.0])
                        .show(ui, |ui| {
                            for game in visible {
                                if game_row(ui, game, username, dark) {
                                    open = Some((game.clone(), username.clone()));
                                }
                                ui.end_row();
                            }
                        });
                }
                if *oldest_index > 0 {
                    ui.add_space(8.0);
                    let label = if *loading_more {
                        "Chargement…"
                    } else {
                        "Mois précédent"
                    };
                    more = ui
                        .add_enabled(!*loading_more, egui::Button::new(label))
                        .clicked();
                    if let Some(error) = more_error {
                        ui.colored_label(theme::error_color(dark), error);
                    }
                }
            }
        }
        if retry {
            let query = self.last_query.clone();
            self.search(&query);
        }
        if more {
            self.load_previous_month();
        }
        if let Some((game, username)) = open {
            self.open(game, username);
        }
    }
}

fn preset_option(preset: Preset) -> &'static str {
    match preset {
        Preset::Standard => "Standard (profondeur 14, rapide)",
        Preset::Deep => "Profonde (profondeur 18, plus lente)",
    }
}

fn filter_label(filter: &str) -> &'static str {
    if filter == "all" {
        "Toutes"
    } else {
        time_class_label(filter)
    }
}

/// Une ligne de la liste ; vrai si l'utilisateur l'ouvre.
fn game_row(ui: &mut egui::Ui, game: &GameSummary, username: &str, dark: bool) -> bool {
    let view = perspective(game, username);
    let date = theme::format_date(game.end_time);
    let side = if view.is_black { "Noirs" } else { "Blancs" };
    let mut opened = false;
    if game.supported {
        let label = format!(
            "Partie du {date}, {} contre {} ({})",
            side.to_lowercase(),
            view.opponent.username,
            view.opponent.rating
        );
        opened = ui.button("Ouvrir").on_hover_text(label).clicked();
    } else {
        ui.add_enabled(false, egui::Button::new("Ouvrir"))
            .on_disabled_hover_text("Variante non prise en charge");
    }
    ui.label(date);
    ui.label(side);
    ui.label(format!(
        "{} ({})",
        view.opponent.username, view.opponent.rating
    ));
    ui.label(time_class_label(&game.time_class));
    ui.colored_label(
        theme::outcome_color(view.outcome, dark),
        view.outcome.label(),
    );
    if game.supported {
        ui.label(format!("{} coups", game.move_count));
    } else {
        ui.colored_label(
            theme::muted(dark),
            format!("Variante non prise en charge ({})", game.rules),
        );
    }
    opened
}

impl eframe::App for ChessApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.handle_api_events();
        if let Some(mut hook) = self.on_frame.take() {
            hook(ui.ctx(), self);
            self.on_frame = Some(hook);
        }
        let dark = ui.visuals().dark_mode;

        egui::Panel::top("entete").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.heading(RichText::new("ChessAnalyser").strong());
                ui.label(
                    RichText::new("Revue de parties chess.com, analysée sur votre ordinateur")
                        .color(theme::muted(dark)),
                );
            });
        });
        egui::Panel::bottom("pied").show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.label(
                    RichText::new("Projet indépendant, non affilié à Chess.com")
                        .color(theme::muted(dark))
                        .small(),
                );
            });
        });
        egui::CentralPanel::default().show(ui, |ui| {
            let mut back = false;
            if let Some(view) = &mut self.analysis {
                back = view.show(ui, &self.shared);
            } else {
                egui::ScrollArea::vertical()
                    .auto_shrink(false)
                    .show(ui, |ui| self.search_screen(ui));
            }
            if back && let Some(view) = self.analysis.take() {
                view.close(&self.shared);
            }
        });
    }
}
