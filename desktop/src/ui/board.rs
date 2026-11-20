//! Échiquier (dessin, clic puis clic, glisser-déposer), barre et courbe d'évaluation.

use eframe::egui::{
    self, Align2, Color32, CornerRadius, FontId, ImageSource, Pos2, Rect, Sense, Shape, Stroke,
    StrokeKind, Vec2, pos2, vec2,
};
use shakmaty::{File, Rank, Role, Square};

use super::theme::{self, ARROW, DARK_SQUARE, LAST_MOVE, LIGHT_SQUARE, SELECTED};
use crate::analysis::{Category, MoveAnalysis, white_bar_percent};
use crate::chess::{Color, pieces, side_to_move};
use crate::engine::{PositionEval, Score};

fn piece_image(color: Color, role: Role) -> ImageSource<'static> {
    use Color::{Black, White};
    match (color, role) {
        (White, Role::King) => egui::include_image!("../../assets/pieces/wK.svg"),
        (White, Role::Queen) => egui::include_image!("../../assets/pieces/wQ.svg"),
        (White, Role::Rook) => egui::include_image!("../../assets/pieces/wR.svg"),
        (White, Role::Bishop) => egui::include_image!("../../assets/pieces/wB.svg"),
        (White, Role::Knight) => egui::include_image!("../../assets/pieces/wN.svg"),
        (White, Role::Pawn) => egui::include_image!("../../assets/pieces/wP.svg"),
        (Black, Role::King) => egui::include_image!("../../assets/pieces/bK.svg"),
        (Black, Role::Queen) => egui::include_image!("../../assets/pieces/bQ.svg"),
        (Black, Role::Rook) => egui::include_image!("../../assets/pieces/bR.svg"),
        (Black, Role::Bishop) => egui::include_image!("../../assets/pieces/bB.svg"),
        (Black, Role::Knight) => egui::include_image!("../../assets/pieces/bN.svg"),
        (Black, Role::Pawn) => egui::include_image!("../../assets/pieces/bP.svg"),
    }
}

/// État d'interaction de l'échiquier, conservé d'une image à l'autre.
#[derive(Default)]
pub struct BoardState {
    /// Case sélectionnée (clic puis clic), valable pour la position donnée seulement.
    selected: Option<(String, Square)>,
    dragging: Option<(String, Square)>,
}

pub struct BoardView<'a> {
    pub fen: &'a str,
    /// Vrai : noirs en bas.
    pub flipped: bool,
    pub last_move: Option<(Square, Square)>,
    pub arrows: Vec<(Square, Square)>,
    /// L'échiquier accepte des coups (exploration des variantes).
    pub interactive: bool,
    pub size: f32,
}

fn square_rect(origin: Pos2, cell: f32, square: Square, flipped: bool) -> Rect {
    let file = u32::from(square.file()) as f32;
    let rank = u32::from(square.rank()) as f32;
    let (col, row) = if flipped {
        (7.0 - file, rank)
    } else {
        (file, 7.0 - rank)
    };
    Rect::from_min_size(origin + vec2(col * cell, row * cell), Vec2::splat(cell))
}

fn square_at(origin: Pos2, cell: f32, pos: Pos2, flipped: bool) -> Option<Square> {
    let local = pos - origin;
    if local.x < 0.0 || local.y < 0.0 {
        return None;
    }
    let col = (local.x / cell) as u32;
    let row = (local.y / cell) as u32;
    if col > 7 || row > 7 {
        return None;
    }
    let (file, rank) = if flipped {
        (7 - col, row)
    } else {
        (col, 7 - row)
    };
    Some(Square::from_coords(File::new(file), Rank::new(rank)))
}

/// Dessine l'échiquier ; renvoie le coup demandé par l'utilisateur (case de départ, d'arrivée).
pub fn board(
    ui: &mut egui::Ui,
    state: &mut BoardState,
    view: &BoardView<'_>,
) -> Option<(Square, Square)> {
    let sense = if view.interactive {
        Sense::click_and_drag()
    } else {
        Sense::hover()
    };
    let (rect, response) = ui.allocate_exact_size(Vec2::splat(view.size), sense);
    let label = if view.interactive {
        "Échiquier, coups jouables à la souris"
    } else {
        "Échiquier"
    };
    response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Image, true, label));
    let painter = ui.painter_at(rect);
    let cell = view.size / 8.0;
    let origin = rect.min;
    let fen = view.fen.to_string();

    // Une sélection ne survit pas à un changement de position.
    if state.selected.as_ref().is_some_and(|(f, _)| *f != fen) {
        state.selected = None;
    }
    if state.dragging.as_ref().is_some_and(|(f, _)| *f != fen) {
        state.dragging = None;
    }
    let turn = side_to_move(view.fen);
    let position = pieces(view.fen);
    let own_piece_at = |sq: Square| position.iter().any(|(s, c, _)| *s == sq && *c == turn);

    let mut requested = None;
    if view.interactive {
        let pointer = response.interact_pointer_pos();
        if response.drag_started()
            && let Some(sq) = pointer.and_then(|p| square_at(origin, cell, p, view.flipped))
            && own_piece_at(sq)
        {
            state.dragging = Some((fen.clone(), sq));
            state.selected = None;
        }
        if response.drag_stopped() {
            if let Some((_, from)) = state.dragging.take() {
                let target = ui
                    .ctx()
                    .pointer_latest_pos()
                    .and_then(|p| square_at(origin, cell, p, view.flipped));
                if let Some(to) = target.filter(|to| *to != from) {
                    requested = Some((from, to));
                }
            }
        } else if response.clicked()
            && let Some(sq) = pointer.and_then(|p| square_at(origin, cell, p, view.flipped))
        {
            match state.selected.take() {
                Some((_, from)) if from != sq && !own_piece_at(sq) => requested = Some((from, sq)),
                Some((_, from)) if from == sq => {}
                _ if own_piece_at(sq) => state.selected = Some((fen.clone(), sq)),
                _ => {}
            }
        }
        if response.hovered() {
            ui.ctx().set_cursor_icon(if state.dragging.is_some() {
                egui::CursorIcon::Grabbing
            } else {
                egui::CursorIcon::PointingHand
            });
        }
    }

    // Cases et coordonnées.
    for file in 0..8u32 {
        for rank in 0..8u32 {
            let square = Square::from_coords(File::new(file), Rank::new(rank));
            let r = square_rect(origin, cell, square, view.flipped);
            let light = (file + rank) % 2 == 1;
            painter.rect_filled(
                r,
                CornerRadius::ZERO,
                if light { LIGHT_SQUARE } else { DARK_SQUARE },
            );
            if view
                .last_move
                .is_some_and(|(a, b)| a == square || b == square)
            {
                painter.rect_filled(r, CornerRadius::ZERO, LAST_MOVE);
            }
            let label_color = if light { DARK_SQUARE } else { LIGHT_SQUARE };
            let font = FontId::proportional((cell * 0.2).max(9.0));
            let left_edge = if view.flipped { file == 7 } else { file == 0 };
            let bottom_edge = if view.flipped { rank == 7 } else { rank == 0 };
            if left_edge {
                painter.text(
                    r.left_top() + vec2(3.0, 2.0),
                    Align2::LEFT_TOP,
                    (rank + 1).to_string(),
                    font.clone(),
                    label_color,
                );
            }
            if bottom_edge {
                let letter = char::from(b'a' + file as u8).to_string();
                painter.text(
                    r.right_bottom() - vec2(3.0, 2.0),
                    Align2::RIGHT_BOTTOM,
                    letter,
                    font,
                    label_color,
                );
            }
        }
    }
    if let Some((_, sq)) = &state.selected {
        let r = square_rect(origin, cell, *sq, view.flipped).shrink(2.0);
        painter.rect_stroke(
            r,
            CornerRadius::ZERO,
            Stroke::new(4.0, SELECTED),
            StrokeKind::Inside,
        );
    }

    // Pièces (celle qu'on fait glisser suit le pointeur).
    let dragged = state.dragging.as_ref().map(|(_, sq)| *sq);
    for (square, color, role) in &position {
        if Some(*square) == dragged {
            continue;
        }
        let r = square_rect(origin, cell, *square, view.flipped);
        egui::Image::new(piece_image(*color, *role)).paint_at(ui, r);
    }

    for (from, to) in &view.arrows {
        arrow(
            &painter,
            square_rect(origin, cell, *from, view.flipped).center(),
            square_rect(origin, cell, *to, view.flipped).center(),
            cell,
        );
    }

    if let (Some(sq), Some(pointer)) = (dragged, ui.ctx().pointer_latest_pos())
        && let Some((_, color, role)) = position.iter().find(|(s, _, _)| *s == sq)
    {
        let r = Rect::from_center_size(pointer, Vec2::splat(cell));
        egui::Image::new(piece_image(*color, *role)).paint_at(ui, r);
    }
    requested
}

fn arrow(painter: &egui::Painter, from: Pos2, to: Pos2, cell: f32) {
    let direction = (to - from).normalized();
    let head = cell * 0.38;
    let tip = to - direction * cell * 0.12;
    let base = tip - direction * head;
    let normal = vec2(-direction.y, direction.x);
    painter.line_segment([from, base], Stroke::new(cell * 0.15, ARROW));
    painter.add(Shape::convex_polygon(
        vec![tip, base + normal * head * 0.6, base - normal * head * 0.6],
        ARROW,
        Stroke::NONE,
    ));
}

/// Barre verticale : part des blancs (un mat la remplit) et libellé du score.
pub fn eval_bar(ui: &mut egui::Ui, score: Option<&Score>, flipped: bool, height: f32) {
    let (rect, response) = ui.allocate_exact_size(vec2(28.0, height), Sense::hover());
    let painter = ui.painter_at(rect);
    let dark_fill = Color32::from_rgb(0x2b, 0x2f, 0x35);
    let white_fill = Color32::from_rgb(0xf4, 0xf1, 0xea);
    let Some(score) = score else {
        painter.rect_filled(
            rect,
            CornerRadius::same(4),
            Color32::from_rgb(0x9a, 0xa1, 0xa9),
        );
        painter.text(
            rect.center(),
            Align2::CENTER_CENTER,
            "…",
            FontId::proportional(12.0),
            Color32::WHITE,
        );
        response.on_hover_text("Évaluation en attente");
        return;
    };
    painter.rect_filled(rect, CornerRadius::same(4), dark_fill);
    let white = white_bar_percent(score) as f32 / 100.0;
    let white_rect = if flipped {
        Rect::from_min_max(
            rect.min,
            pos2(rect.max.x, rect.min.y + rect.height() * white),
        )
    } else {
        Rect::from_min_max(
            pos2(rect.min.x, rect.max.y - rect.height() * white),
            rect.max,
        )
    };
    painter.rect_filled(white_rect, CornerRadius::same(4), white_fill);
    let label = crate::analysis::format_score(score);
    let white_ahead = white >= 0.5;
    // Le libellé se place du côté du camp qui mène, en bas de la barre pour celui du bas.
    let at_bottom = white_ahead != flipped;
    let (anchor, pos, color) = if at_bottom {
        (
            Align2::CENTER_BOTTOM,
            rect.center_bottom() - vec2(0.0, 4.0),
            if white_ahead { dark_fill } else { white_fill },
        )
    } else {
        (
            Align2::CENTER_TOP,
            rect.center_top() + vec2(0.0, 4.0),
            if white_ahead { dark_fill } else { white_fill },
        )
    };
    painter.text(pos, anchor, &label, FontId::proportional(11.0), color);
    response.on_hover_text(format!("Évaluation : {label}"));
}

const GRAPH_W: f32 = 600.0;
const GRAPH_H: f32 = 120.0;
/// Marge latérale : les symboles des premier et dernier coups restent entiers.
const GRAPH_PAD: f32 = 12.0;

/// Courbe d'évaluation ; renvoie la position choisie par un clic.
pub fn eval_graph(
    ui: &mut egui::Ui,
    evals: &[Option<PositionEval>],
    moves: &[Option<MoveAnalysis>],
    total: usize,
    position: usize,
    width: f32,
) -> Option<usize> {
    let dark = ui.visuals().dark_mode;
    let scale = width / (GRAPH_W + 2.0 * GRAPH_PAD);
    let height = (GRAPH_H + 14.0) * scale;
    let (rect, response) = ui.allocate_exact_size(vec2(width, height), Sense::click());
    let painter = ui.painter_at(rect);
    let map = |x: f32, y: f32| pos2(rect.min.x + (x + GRAPH_PAD) * scale, rect.min.y + y * scale);
    let x_of = |i: usize| {
        if total > 1 {
            i as f32 / (total - 1) as f32 * GRAPH_W
        } else {
            GRAPH_W / 2.0
        }
    };
    let y_of = |percent: f64| GRAPH_H - (percent as f32 / 100.0) * GRAPH_H;

    painter.rect_filled(
        Rect::from_min_max(map(0.0, 0.0), map(GRAPH_W, GRAPH_H)),
        CornerRadius::ZERO,
        Color32::from_rgb(0x2b, 0x2f, 0x35),
    );
    let mut points = Vec::new();
    for i in 0..total {
        let Some(Some(eval)) = evals.get(i) else {
            break;
        };
        points.push(map(x_of(i), y_of(white_bar_percent(&eval.score))));
    }
    if points.len() >= 2 {
        // Zone blanche sous la courbe : un maillage d'un seul tenant (sans liseré entre bandes).
        let bottom = map(0.0, GRAPH_H).y;
        let fill = Color32::from_rgb(0xf4, 0xf1, 0xea);
        let mut mesh = egui::Mesh::default();
        for p in &points {
            mesh.colored_vertex(*p, fill);
            mesh.colored_vertex(pos2(p.x, bottom), fill);
        }
        for i in 0..points.len() as u32 - 1 {
            let (top_a, bottom_a, top_b, bottom_b) = (2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3);
            mesh.add_triangle(top_a, bottom_a, top_b);
            mesh.add_triangle(top_b, bottom_a, bottom_b);
        }
        painter.add(Shape::mesh(mesh));
        painter.add(Shape::line(
            points.clone(),
            Stroke::new(1.5, theme::rgb(0x2f5d8a)),
        ));
    }
    painter.line_segment(
        [map(0.0, GRAPH_H / 2.0), map(GRAPH_W, GRAPH_H / 2.0)],
        Stroke::new(1.0, Color32::from_gray(140)),
    );
    painter.line_segment(
        [map(x_of(position), 0.0), map(x_of(position), GRAPH_H)],
        Stroke::new(2.0, theme::rgb(0xc26a00)),
    );

    let mut chosen = None;
    let pointer = response.hover_pos();
    let mut hovered_marker = None;
    for m in moves.iter().flatten().filter(|m| m.category.is_error()) {
        let Some(Some(eval)) = evals.get(m.ply_index) else {
            continue;
        };
        let center = map(x_of(m.ply_index), y_of(white_bar_percent(&eval.score)));
        let color = theme::category_color(m.category, dark);
        painter.circle_filled(center, 5.0 * scale.max(0.8), color);
        let text_y = if center.y - rect.min.y < 16.0 {
            center.y + 16.0
        } else {
            center.y - 8.0
        };
        painter.text(
            pos2(center.x, text_y),
            Align2::CENTER_BOTTOM,
            m.category.symbol(),
            FontId::proportional(12.0),
            color,
        );
        if pointer.is_some_and(|p| p.distance(center) < 9.0) {
            hovered_marker = Some(m);
        }
    }
    if let Some(m) = hovered_marker {
        let tip = format!(
            "{} : demi-coup {}",
            Category::label(m.category),
            m.ply_index
        );
        let response = response.clone().on_hover_text(tip);
        if response.clicked() {
            chosen = Some(m.ply_index);
        }
    }
    if chosen.is_none()
        && response.clicked()
        && rect.width() > 0.0
        && let Some(p) = response.interact_pointer_pos()
    {
        let x = (p.x - rect.min.x) / scale - GRAPH_PAD;
        let ratio = (x / GRAPH_W).clamp(0.0, 1.0);
        chosen = Some((ratio * (total.saturating_sub(1)) as f32).round() as usize);
    }
    chosen
}
