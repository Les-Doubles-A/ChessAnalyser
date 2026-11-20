//! Lecture des PGN et variantes (portage de `src/chess/game.ts` et `src/chess/variation.ts`).

use std::{io, ops::ControlFlow};

use pgn_reader::{RawComment, RawTag, Reader, SanPlus, Visitor};
use shakmaty::{
    CastlingMode, Chess, Color as SColor, EnPassantMode, Move, Position, Role, Square, fen::Fen,
    san::San, uci::UciMove,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Color {
    White,
    Black,
}

impl Color {
    pub fn code(self) -> &'static str {
        match self {
            Color::White => "w",
            Color::Black => "b",
        }
    }

    pub fn other(self) -> Color {
        match self {
            Color::White => Color::Black,
            Color::Black => Color::White,
        }
    }

    fn from_shakmaty(color: SColor) -> Color {
        if color == SColor::White {
            Color::White
        } else {
            Color::Black
        }
    }
}

/// Un demi-coup de la partie ou d'une variante.
#[derive(Clone, Debug, PartialEq)]
pub struct Ply {
    /// Position 1 pour le premier demi-coup ; la position 0 est la position de départ.
    pub index: usize,
    pub color: Color,
    /// Numéro du coup complet, tel qu'affiché (1. e4 e5).
    pub move_number: u32,
    pub san: String,
    pub uci: String,
    pub from: Square,
    pub to: Square,
    pub fen_before: String,
    pub fen_after: String,
    pub legal_move_count: usize,
    pub clock_seconds: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct ParsedGame {
    pub headers: Vec<(String, String)>,
    pub start_fen: String,
    pub plies: Vec<Ply>,
}

impl ParsedGame {
    /// FEN de la position n (0 = départ, n = après le n-ième demi-coup).
    pub fn fen_at(&self, position: usize) -> &str {
        if position == 0 || self.plies.is_empty() {
            return &self.start_fen;
        }
        &self.plies[position.min(self.plies.len()) - 1].fen_after
    }

    /// Toutes les positions : départ puis après chaque demi-coup.
    pub fn fens(&self) -> Vec<String> {
        std::iter::once(self.start_fen.clone())
            .chain(self.plies.iter().map(|p| p.fen_after.clone()))
            .collect()
    }
}

#[derive(Debug)]
pub struct GameParseError(pub String);

impl std::fmt::Display for GameParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Cette partie n’a pas pu être lue ({})", self.0)
    }
}

impl std::error::Error for GameParseError {}

/// FEN au format de chess.js : case en passant seulement si une prise est légale.
pub fn fen_of(pos: &Chess) -> String {
    Fen::from_position(pos, EnPassantMode::Legal).to_string()
}

pub fn position_from_fen(fen: &str) -> Option<Chess> {
    Fen::from_ascii(fen.as_bytes())
        .ok()?
        .into_position(CastlingMode::Standard)
        .ok()
}

/// Lit `[%clk h:mm:ss(.d)]` dans un commentaire.
pub fn parse_clock(comment: &str) -> Option<f64> {
    let start = comment.find("[%clk")?;
    let rest = comment[start + 5..].trim_start();
    let end = rest.find(']')?;
    let parts: Vec<&str> = rest[..end].trim().split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

/// Coup légal → demi-coup, la position étant celle d'avant le coup (elle est jouée ici).
fn make_ply(pos: &mut Chess, m: Move, index: usize) -> Ply {
    let fen_before = fen_of(pos);
    let legal_move_count = pos.legal_moves().len();
    let color = Color::from_shakmaty(pos.turn());
    let move_number = pos.fullmoves().get();
    let uci = UciMove::from_standard(m).to_string();
    let from = m.from().expect("coup standard");
    let to = m.to();
    let san = SanPlus::from_move_and_play_unchecked(pos, m).to_string();
    Ply {
        index,
        color,
        move_number,
        san,
        uci,
        from,
        to,
        fen_before,
        fen_after: fen_of(pos),
        legal_move_count,
        clock_seconds: None,
    }
}

struct GameVisitor;

struct Movetext {
    headers: Vec<(String, String)>,
    pos: Chess,
    start_fen: String,
    plies: Vec<Ply>,
}

impl Visitor for GameVisitor {
    type Tags = (Vec<(String, String)>, Option<Chess>);
    type Movetext = Movetext;
    type Output = Result<ParsedGame, GameParseError>;

    fn begin_tags(&mut self) -> ControlFlow<Self::Output, Self::Tags> {
        ControlFlow::Continue((Vec::new(), None))
    }

    fn tag(
        &mut self,
        tags: &mut Self::Tags,
        name: &[u8],
        value: RawTag<'_>,
    ) -> ControlFlow<Self::Output> {
        let name = String::from_utf8_lossy(name).into_owned();
        let value = value
            .decode_utf8()
            .map(|v| v.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(value.as_bytes()).into_owned());
        if name == "FEN" {
            match position_from_fen(&value) {
                Some(pos) => tags.1 = Some(pos),
                None => {
                    return ControlFlow::Break(Err(GameParseError(format!(
                        "FEN illisible : {value}"
                    ))));
                }
            }
        }
        tags.0.push((name, value));
        ControlFlow::Continue(())
    }

    fn begin_movetext(&mut self, tags: Self::Tags) -> ControlFlow<Self::Output, Self::Movetext> {
        let pos = tags.1.unwrap_or_default();
        ControlFlow::Continue(Movetext {
            headers: tags.0,
            start_fen: fen_of(&pos),
            pos,
            plies: Vec::new(),
        })
    }

    fn san(
        &mut self,
        movetext: &mut Self::Movetext,
        san_plus: SanPlus,
    ) -> ControlFlow<Self::Output> {
        match san_plus.san.to_move(&movetext.pos) {
            Ok(m) => {
                let index = movetext.plies.len() + 1;
                let ply = make_ply(&mut movetext.pos, m, index);
                movetext.plies.push(ply);
                ControlFlow::Continue(())
            }
            Err(error) => ControlFlow::Break(Err(GameParseError(format!(
                "coup illégal {san_plus} : {error}"
            )))),
        }
    }

    fn comment(
        &mut self,
        movetext: &mut Self::Movetext,
        comment: RawComment<'_>,
    ) -> ControlFlow<Self::Output> {
        if let Some(last) = movetext.plies.last_mut()
            && let Some(seconds) = parse_clock(&String::from_utf8_lossy(comment.as_bytes()))
        {
            last.clock_seconds = Some(seconds);
        }
        ControlFlow::Continue(())
    }

    fn end_game(&mut self, movetext: Self::Movetext) -> Self::Output {
        Ok(ParsedGame {
            headers: movetext.headers,
            start_fen: movetext.start_fen,
            plies: movetext.plies,
        })
    }
}

pub fn parse_game(pgn: &str) -> Result<ParsedGame, GameParseError> {
    let mut reader = Reader::new(io::Cursor::new(pgn.as_bytes()));
    match reader.read_game(&mut GameVisitor) {
        Ok(Some(result)) => result,
        Ok(None) => Err(GameParseError("partie vide".into())),
        Err(error) => Err(GameParseError(error.to_string())),
    }
}

/// Coup UCI (« e2e4 », « e7e8q ») joué depuis `fen`, en notation algébrique ; None s'il est illégal.
pub fn uci_to_san(fen: &str, uci: &str) -> Option<String> {
    let pos = position_from_fen(fen)?;
    let m = uci.parse::<UciMove>().ok()?.to_move(&pos).ok()?;
    Some(SanPlus::from_move(pos, m).to_string())
}

/// Ligne principale du moteur (UCI) en notation algébrique, au plus `max` coups.
pub fn pv_to_san(fen: &str, pv: &[String], max: usize) -> Vec<String> {
    let Some(mut pos) = position_from_fen(fen) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for uci in pv.iter().take(max) {
        let Some(m) = uci
            .parse::<UciMove>()
            .ok()
            .and_then(|u| u.to_move(&pos).ok())
        else {
            break;
        };
        out.push(SanPlus::from_move_and_play_unchecked(&mut pos, m).to_string());
    }
    out
}

/// Ligne numérotée à partir d'une position : « 13. Nxe5 Nxe5 14. Bxf7+ ».
pub fn format_line(fen: &str, san: &[String]) -> String {
    let parts: Vec<&str> = fen.split(' ').collect();
    let mut white = parts.get(1) != Some(&"b");
    let mut number: u32 = parts.get(5).and_then(|n| n.parse().ok()).unwrap_or(1);
    let mut out = Vec::new();
    for (i, mv) in san.iter().enumerate() {
        if white {
            out.push(format!("{number}. {mv}"));
        } else if i == 0 {
            out.push(format!("{number}... {mv}"));
        } else {
            out.push(mv.clone());
        }
        if !white {
            number += 1;
        }
        white = !white;
    }
    out.join(" ")
}

/// Libellé d'un coup : « 12. Nf3 » ou « 12... Nf6 ».
pub fn move_label(ply: &Ply) -> String {
    let dots = if ply.color == Color::White {
        "."
    } else {
        "..."
    };
    format!("{}{} {}", ply.move_number, dots, ply.san)
}

// ---------------------------------------------------------------------------------------
// Variantes (F10)

/// Variante jouée par l'utilisateur à partir d'une position de la partie (jamais d'une
/// position saisie librement : garde-fou R8 contre l'usage pendant une partie en cours).
#[derive(Clone, Debug, PartialEq)]
pub struct Variation {
    /// Position de la partie d'où part la variante (0 = départ).
    pub base: usize,
    pub start_fen: String,
    pub plies: Vec<Ply>,
}

impl Variation {
    pub fn fens(&self) -> Vec<String> {
        std::iter::once(self.start_fen.clone())
            .chain(self.plies.iter().map(|p| p.fen_after.clone()))
            .collect()
    }

    /// La variante sous forme de partie, pour réutiliser le rapport d'analyse.
    pub fn as_game(&self) -> ParsedGame {
        ParsedGame {
            headers: Vec::new(),
            start_fen: self.start_fen.clone(),
            plies: self.plies.clone(),
        }
    }
}

/// Position affichée : dans la partie, ou dans une variante (curseur 0 = départ de la variante).
#[derive(Clone, Debug, PartialEq, Default)]
pub struct ExploreState {
    pub position: usize,
    pub variation: Option<Variation>,
    pub cursor: usize,
}

pub enum MoveInput {
    Text(String),
    Squares {
        from: Square,
        to: Square,
        promotion: Option<Role>,
    },
}

fn french_to_english(letter: char) -> Option<char> {
    match letter {
        'R' => Some('K'),
        'D' => Some('Q'),
        'T' => Some('R'),
        'F' => Some('B'),
        'C' => Some('N'),
        _ => None,
    }
}

fn try_text(pos: &Chess, text: &str) -> Option<Move> {
    let text = text.trim();
    if text.is_empty() || text.chars().all(|c| c == '-') {
        return None;
    }
    if let Ok(san) = text.parse::<SanPlus>()
        && let Ok(m) = san.san.to_move(pos)
    {
        return Some(m);
    }
    if let Ok(san) = text.parse::<San>()
        && let Ok(m) = san.to_move(pos)
    {
        return Some(m);
    }
    text.parse::<UciMove>().ok()?.to_move(pos).ok()
}

/// Traduit la notation française (Cf3, a8=D) en notation anglaise.
fn translate_french(text: &str) -> String {
    let text = text.trim();
    let mut chars: Vec<char> = text.chars().collect();
    if let Some(first) = chars.first().copied().and_then(french_to_english) {
        chars[0] = first;
    }
    // Promotion : « a8=D », « exd8C+ » ou « a8D » (lettre après une rangée 1 ou 8).
    let suffix = chars
        .iter()
        .rev()
        .take_while(|c| **c == '+' || **c == '#')
        .count();
    let end = chars.len() - suffix;
    if end >= 2 {
        let letter = chars[end - 1];
        if let Some(english) = french_to_english(letter).filter(|_| letter != 'R') {
            let before = chars[end - 2];
            if before == '=' && end >= 3 && matches!(chars[end - 3], '1' | '8') {
                chars[end - 1] = english;
            } else if matches!(before, '1' | '8') {
                chars[end - 1] = english;
                chars.insert(end - 1, '=');
            }
        }
    }
    chars.into_iter().collect()
}

/// Lit un coup en notation anglaise (Nf3), française (Cf3) ou par cases (g1f3) et le joue
/// depuis `fen`. None si le coup est illégal ou illisible.
pub fn make_ply_from_input(fen: &str, input: &MoveInput, index: usize) -> Option<Ply> {
    let pos = position_from_fen(fen)?;
    let m = match input {
        MoveInput::Squares {
            from,
            to,
            promotion,
        } => {
            let promotion = promotion.or(Some(Role::Queen));
            pos.legal_moves().into_iter().find(|m| {
                m.from() == Some(*from)
                    && (m.to() == *to || castling_target(m) == Some(*to))
                    && (m.promotion().is_none() || m.promotion() == promotion)
            })?
        }
        MoveInput::Text(text) => match try_text(&pos, text) {
            Some(m) => m,
            None => {
                let french = translate_french(text);
                if french == text.trim() {
                    return None;
                }
                try_text(&pos, &french)?
            }
        },
    };
    let mut pos = pos;
    Some(make_ply(&mut pos, m, index))
}

/// Case d'arrivée du roi pour un roque (shakmaty code le roque « roi prend tour »).
fn castling_target(m: &Move) -> Option<Square> {
    match m {
        Move::Castle { king, rook } => {
            let file = if rook.file() > king.file() {
                shakmaty::File::G
            } else {
                shakmaty::File::C
            };
            Some(Square::from_coords(file, king.rank()))
        }
        _ => None,
    }
}

/// Vrai si le déplacement from → to est une promotion légale, qui demande donc une pièce.
pub fn is_promotion(fen: &str, from: Square, to: Square) -> bool {
    position_from_fen(fen).is_some_and(|pos| {
        pos.legal_moves()
            .iter()
            .any(|m| m.from() == Some(from) && m.to() == to && m.promotion().is_some())
    })
}

/// Pièces du camp au trait qui peuvent être déplacées (pour le glisser-déposer).
pub fn side_to_move(fen: &str) -> Color {
    if fen.split(' ').nth(1) == Some("b") {
        Color::Black
    } else {
        Color::White
    }
}

pub fn current_fen(game: &ParsedGame, state: &ExploreState) -> String {
    match &state.variation {
        None => game.fen_at(state.position).to_string(),
        Some(v) => {
            if state.cursor == 0 {
                v.start_fen.clone()
            } else {
                v.plies[state.cursor - 1].fen_after.clone()
            }
        }
    }
}

/// Dernier coup menant à la position affichée, pour le surlignage et le libellé.
pub fn current_ply<'a>(game: &'a ParsedGame, state: &'a ExploreState) -> Option<&'a Ply> {
    match &state.variation {
        None => state
            .position
            .checked_sub(1)
            .and_then(|i| game.plies.get(i)),
        Some(v) => {
            if state.cursor == 0 {
                v.base.checked_sub(1).and_then(|i| game.plies.get(i))
            } else {
                v.plies.get(state.cursor - 1)
            }
        }
    }
}

/// Joue un coup depuis la position affichée. Le coup réellement joué dans la partie (ou le
/// coup suivant de la variante) fait simplement avancer ; tout autre coup ouvre une variante,
/// ou remplace la suite de la variante en cours à partir du curseur.
pub fn play_move(
    game: &ParsedGame,
    state: &ExploreState,
    input: &MoveInput,
) -> Option<ExploreState> {
    let base = state.variation.as_ref().map_or(state.position, |v| v.base);
    let depth = if state.variation.is_some() {
        state.cursor
    } else {
        0
    };
    let ply = make_ply_from_input(&current_fen(game, state), input, base + depth + 1)?;

    match &state.variation {
        None => {
            if game
                .plies
                .get(state.position)
                .is_some_and(|p| p.uci == ply.uci)
            {
                return Some(ExploreState {
                    position: state.position + 1,
                    variation: None,
                    cursor: 0,
                });
            }
            let start_fen = game.fen_at(state.position).to_string();
            Some(ExploreState {
                position: state.position,
                variation: Some(Variation {
                    base,
                    start_fen,
                    plies: vec![ply],
                }),
                cursor: 1,
            })
        }
        Some(v) => {
            if v.plies.get(state.cursor).is_some_and(|p| p.uci == ply.uci) {
                return Some(ExploreState {
                    cursor: state.cursor + 1,
                    ..state.clone()
                });
            }
            let mut plies = v.plies[..state.cursor].to_vec();
            plies.push(ply);
            Some(ExploreState {
                position: state.position,
                variation: Some(Variation { plies, ..v.clone() }),
                cursor: state.cursor + 1,
            })
        }
    }
}

/// Recule d'un demi-coup (dans la variante, ou dans la partie).
pub fn step_back(state: &ExploreState) -> ExploreState {
    if state.variation.is_some() {
        ExploreState {
            cursor: state.cursor.saturating_sub(1),
            ..state.clone()
        }
    } else {
        ExploreState {
            position: state.position.saturating_sub(1),
            ..state.clone()
        }
    }
}

/// Évaluation sans moteur des positions finales : mat ou pat.
pub fn terminal_kind(fen: &str) -> Option<Terminal> {
    let pos = position_from_fen(fen)?;
    if pos.is_checkmate() {
        Some(Terminal::Checkmate {
            winner: Color::from_shakmaty(pos.turn()).other(),
        })
    } else if pos.is_stalemate() {
        Some(Terminal::Stalemate)
    } else {
        None
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Terminal {
    Checkmate { winner: Color },
    Stalemate,
}

/// Pièce sur une case, pour l'affichage : (couleur, rôle).
pub fn pieces(fen: &str) -> Vec<(Square, Color, Role)> {
    let Some(pos) = position_from_fen(fen) else {
        return Vec::new();
    };
    pos.board()
        .iter()
        .map(|(sq, piece)| (sq, Color::from_shakmaty(piece.color), piece.role))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    #[test]
    fn notations_anglaise_francaise_et_cases() {
        for text in ["Nf3", "Cf3", "g1f3"] {
            assert_eq!(
                make_ply_from_input(START, &MoveInput::Text(text.into()), 1)
                    .unwrap()
                    .san,
                "Nf3"
            );
        }
        assert!(make_ply_from_input(START, &MoveInput::Text("--".into()), 1).is_none());
        assert!(make_ply_from_input(START, &MoveInput::Text("bonjour".into()), 1).is_none());
    }

    #[test]
    fn promotions_francaises() {
        let fen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
        assert!(
            make_ply_from_input(fen, &MoveInput::Text("a8=D".into()), 1)
                .unwrap()
                .san
                .starts_with("a8=Q")
        );
        assert_eq!(
            make_ply_from_input(fen, &MoveInput::Text("a8C".into()), 1)
                .unwrap()
                .san,
            "a8=N"
        );
        assert!(is_promotion(fen, Square::A7, Square::A8));
        assert!(!is_promotion(START, Square::E2, Square::E4));
    }

    #[test]
    fn roque_par_cases() {
        let fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
        let ply = make_ply_from_input(
            fen,
            &MoveInput::Squares {
                from: Square::E1,
                to: Square::G1,
                promotion: None,
            },
            1,
        )
        .unwrap();
        assert_eq!((ply.san.as_str(), ply.uci.as_str()), ("O-O", "e1g1"));
    }

    #[test]
    fn ligne_numerotee() {
        let fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
        let line = format_line(fen, &["Bb5".into(), "a6".into(), "Ba4".into()]);
        assert_eq!(line, "3. Bb5 a6 4. Ba4");
        let black = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
        assert_eq!(
            format_line(black, &["e5".into(), "Nf3".into()]),
            "1... e5 2. Nf3"
        );
    }

    #[test]
    fn horloge() {
        assert_eq!(parse_clock("[%clk 0:09:55.9]"), Some(595.9));
        assert_eq!(parse_clock("sans horloge"), None);
    }
}
