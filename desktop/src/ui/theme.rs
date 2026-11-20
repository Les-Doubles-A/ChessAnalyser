//! Couleurs (palette du site, claire et sombre), polices et formats d'affichage.

use eframe::egui::{self, Color32, FontData, FontDefinitions, FontFamily};

use crate::analysis::Category;
use crate::chesscom::Outcome;

pub fn rgb(hex: u32) -> Color32 {
    Color32::from_rgb((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}

/// Couleur d'une catégorie de coup, comme `--cat-*` dans src/styles.css.
pub fn category_color(category: Category, dark: bool) -> Color32 {
    let (light, night) = match category {
        Category::Book => (0x8a6d4b, 0xc9a57d),
        Category::Forced => (0x6f7680, 0xa3acb6),
        Category::Best => (0x1f6fb2, 0x7fb0e0),
        Category::Excellent => (0x2f8a5b, 0x6fd28f),
        Category::Good => (0x5f7f72, 0x9cc3b3),
        Category::Inaccuracy => (0xa8860f, 0xe6c34d),
        Category::Mistake => (0xc3611c, 0xff9d5c),
        Category::Blunder => (0xb42318, 0xff8a80),
    };
    rgb(if dark { night } else { light })
}

pub fn outcome_color(outcome: Outcome, dark: bool) -> Color32 {
    match outcome {
        Outcome::Win => rgb(if dark { 0x6fd28f } else { 0x1f7a3d }),
        Outcome::Loss => rgb(if dark { 0xff8a80 } else { 0xb42318 }),
        Outcome::Draw => muted(dark),
    }
}

pub fn muted(dark: bool) -> Color32 {
    rgb(if dark { 0xa3acb6 } else { 0x59636e })
}

pub fn error_color(dark: bool) -> Color32 {
    rgb(if dark { 0xff8a80 } else { 0xb42318 })
}

pub fn current_move_fill(dark: bool) -> Color32 {
    rgb(if dark { 0x8a6d1f } else { 0xf0be46 })
}

// Échiquier : palette propre au projet (ardoise et ivoire), distincte de celle de chess.com.
pub const LIGHT_SQUARE: Color32 = Color32::from_rgb(0xe9, 0xe4, 0xd6);
pub const DARK_SQUARE: Color32 = Color32::from_rgb(0x7d, 0x8f, 0xa0);
pub const LAST_MOVE: Color32 = Color32::from_rgba_premultiplied(132, 105, 39, 140);
pub const SELECTED: Color32 = Color32::from_rgb(0x1f, 0x6f, 0xb2);
pub const ARROW: Color32 = Color32::from_rgba_premultiplied(26, 94, 151, 217);

/// Polices de Windows quand elles existent (Segoe UI, et Segoe UI Symbol pour □, ≈, …),
/// sinon les polices intégrées d'egui.
pub fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    let candidates = [
        ("segoe-ui", r"C:\Windows\Fonts\segoeui.ttf", true),
        ("segoe-ui-symbol", r"C:\Windows\Fonts\seguisym.ttf", false),
    ];
    let mut first = 0;
    for (name, path, primary) in candidates {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        fonts
            .font_data
            .insert(name.to_owned(), FontData::from_owned(bytes).into());
        let family = fonts.families.entry(FontFamily::Proportional).or_default();
        if primary {
            family.insert(first, name.to_owned());
            first += 1;
        } else {
            family.push(name.to_owned());
        }
        fonts
            .families
            .entry(FontFamily::Monospace)
            .or_default()
            .push(name.to_owned());
    }
    ctx.set_fonts(fonts);
}

/// Date locale au format jj/mm/aaaa.
pub fn format_date(end_time: i64) -> String {
    use chrono::{Local, TimeZone};
    match Local.timestamp_opt(end_time, 0).single() {
        Some(date) => date.format("%d/%m/%Y").to_string(),
        None => "?".into(),
    }
}

/// Précision affichée : « 82,8 », ou des points de suspension si elle n'est pas disponible.
pub fn format_accuracy(value: Option<f64>) -> String {
    value.map_or_else(|| "…".into(), |v| format!("{v:.1}").replace('.', ","))
}
