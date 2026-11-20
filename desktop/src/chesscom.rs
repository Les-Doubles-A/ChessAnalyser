//! Client de l'API publique chess.com (portage de `src/api/chesscom.ts`). Les requêtes passent
//! par un seul thread, donc en série : l'API tolère l'accès en série mais peut répondre 429
//! aux requêtes parallèles.

use std::{
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::Duration,
};

use serde_json::Value;

const API_BASE: &str = "https://api.chess.com/pub/player/";
const RATE_LIMIT_RETRY: Duration = Duration::from_secs(2);
const MAX_EMPTY_MONTHS_SKIPPED: usize = 3;
const USER_AGENT: &str = concat!(
    "ChessAnalyser-desktop/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/Les-Doubles-A/ChessAnalyser)"
);

#[derive(Clone, Debug, PartialEq)]
pub struct PlayerSide {
    pub username: String,
    pub rating: i64,
    pub result: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Win,
    Loss,
    Draw,
}

impl Outcome {
    pub fn label(self) -> &'static str {
        match self {
            Outcome::Win => "Victoire",
            Outcome::Loss => "Défaite",
            Outcome::Draw => "Nulle",
        }
    }
}

const DRAW_RESULTS: [&str; 6] = [
    "agreed",
    "repetition",
    "stalemate",
    "insufficient",
    "50move",
    "timevsinsufficient",
];

pub fn outcome_for(side: &PlayerSide) -> Outcome {
    if side.result == "win" {
        Outcome::Win
    } else if DRAW_RESULTS.contains(&side.result.as_str()) {
        Outcome::Draw
    } else {
        Outcome::Loss
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct GameSummary {
    pub url: String,
    pub end_time: i64,
    /// bullet, blitz, rapid, daily ou unknown.
    pub time_class: String,
    pub rules: String,
    pub rated: bool,
    pub white: PlayerSide,
    pub black: PlayerSide,
    pub pgn: String,
    pub move_count: u32,
    pub supported: bool,
}

pub fn time_class_label(time_class: &str) -> &'static str {
    match time_class {
        "bullet" => "Bullet",
        "blitz" => "Blitz",
        "rapid" => "Rapide",
        "daily" => "Daily",
        _ => "Autre",
    }
}

/// Point de vue du joueur recherché ; blancs par défaut s'il ne figure pas dans la partie.
pub struct Perspective<'a> {
    pub is_black: bool,
    pub me: &'a PlayerSide,
    pub opponent: &'a PlayerSide,
    pub outcome: Outcome,
}

pub fn perspective<'a>(game: &'a GameSummary, username: &str) -> Perspective<'a> {
    let is_black = game.black.username.eq_ignore_ascii_case(username);
    let (me, opponent) = if is_black {
        (&game.black, &game.white)
    } else {
        (&game.white, &game.black)
    };
    Perspective {
        is_black,
        me,
        opponent,
        outcome: outcome_for(me),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ChessComError {
    NotFound,
    RateLimited,
    Unavailable,
    BadResponse,
}

impl std::fmt::Display for ChessComError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ChessComError::NotFound => "Joueur introuvable.",
            ChessComError::BadResponse => "Réponse inattendue de chess.com.",
            ChessComError::RateLimited | ChessComError::Unavailable => "chess.com ne répond pas.",
        })
    }
}

pub fn normalize_username(raw: &str) -> String {
    raw.trim().to_lowercase()
}

/// Règle locale volontairement stricte : 3 à 25 caractères, lettres, chiffres, « _ » ou « - ».
pub fn validate_username(raw: &str) -> Result<String, String> {
    let value = normalize_username(raw);
    let ok = (3..=25).contains(&value.chars().count())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(value)
    } else {
        Err("Pseudo invalide : 3 à 25 caractères, lettres, chiffres, « _ » ou « - ».".into())
    }
}

/// Nombre de coups complets, d'après la numérotation du PGN.
pub fn count_moves(pgn: &str) -> u32 {
    // Commentaires d'abord (ils peuvent contenir « [%clk …] »), puis les lignes d'en-tête.
    let mut without_comments = String::with_capacity(pgn.len());
    let mut depth = 0;
    for c in pgn.chars() {
        match c {
            '{' => depth += 1,
            '}' if depth > 0 => depth -= 1,
            _ if depth == 0 => without_comments.push(c),
            _ => {}
        }
    }
    let movetext: String = without_comments
        .lines()
        .filter(|line| {
            let t = line.trim();
            !(t.starts_with('[') && t.ends_with(']'))
        })
        .collect::<Vec<_>>()
        .join(" ");
    let bytes = movetext.as_bytes();
    let mut max = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() && (i == 0 || !bytes[i - 1].is_ascii_digit()) {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            let followed_by_dot = bytes.get(i) == Some(&b'.');
            let not_ellipsis = bytes.get(i + 1) != Some(&b'.');
            if followed_by_dot
                && not_ellipsis
                && let Ok(n) = movetext[start..i].parse::<u32>()
            {
                max = max.max(n);
            }
        } else {
            i += 1;
        }
    }
    max
}

fn is_archive_url(value: &str) -> bool {
    // https://api.chess.com/pub/player/<pseudo>/games/<AAAA>/<MM>
    let Some(rest) = value.strip_prefix(API_BASE) else {
        return false;
    };
    let parts: Vec<&str> = rest.split('/').collect();
    parts.len() == 4
        && !parts[0].is_empty()
        && !parts[0].contains(['?', '#'])
        && parts[1] == "games"
        && parts[2].len() == 4
        && parts[2].bytes().all(|b| b.is_ascii_digit())
        && parts[3].len() == 2
        && parts[3].bytes().all(|b| b.is_ascii_digit())
}

fn player_side(value: &Value) -> Option<PlayerSide> {
    Some(PlayerSide {
        username: value.get("username")?.as_str()?.to_string(),
        rating: value.get("rating")?.as_i64()?,
        result: value.get("result")?.as_str()?.to_string(),
    })
}

pub fn game_summary(value: &Value) -> Option<GameSummary> {
    let white = player_side(value.get("white")?)?;
    let black = player_side(value.get("black")?)?;
    let url = value.get("url")?.as_str()?;
    if !url.starts_with("https://www.chess.com/") {
        return None;
    }
    let end_time = value.get("end_time")?.as_i64()?;
    let rules = value.get("rules")?.as_str()?.to_string();
    let pgn = value.get("pgn")?.as_str()?.to_string();
    let time_class = match value.get("time_class").and_then(Value::as_str) {
        Some(t @ ("bullet" | "blitz" | "rapid" | "daily")) => t.to_string(),
        _ => "unknown".to_string(),
    };
    Some(GameSummary {
        url: url.to_string(),
        end_time,
        time_class,
        supported: rules == "chess",
        rules,
        rated: value.get("rated").and_then(Value::as_bool) == Some(true),
        white,
        black,
        move_count: count_moves(&pgn),
        pgn,
    })
}

/// Parties d'une archive mensuelle, de la plus récente à la plus ancienne.
pub fn parse_month(body: &Value) -> Result<Vec<GameSummary>, ChessComError> {
    let games = body
        .get("games")
        .and_then(Value::as_array)
        .ok_or(ChessComError::BadResponse)?;
    let mut parsed: Vec<GameSummary> = games.iter().filter_map(game_summary).collect();
    parsed.sort_by_key(|g| std::cmp::Reverse(g.end_time));
    Ok(parsed)
}

pub fn parse_archives(body: &Value) -> Result<Vec<String>, ChessComError> {
    let archives = body
        .get("archives")
        .and_then(Value::as_array)
        .ok_or(ChessComError::BadResponse)?;
    archives
        .iter()
        .map(|a| a.as_str().filter(|s| is_archive_url(s)).map(str::to_string))
        .collect::<Option<Vec<_>>>()
        .ok_or(ChessComError::BadResponse)
}

/// Transport HTTP, remplaçable dans les tests.
pub trait Http: Send {
    /// (statut, corps) ; Err si la requête n'a pas abouti.
    fn get(&mut self, url: &str) -> Result<(u16, String), String>;
}

pub struct UreqHttp {
    agent: ureq::Agent,
}

impl Default for UreqHttp {
    fn default() -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .http_status_as_error(false)
            .user_agent(USER_AGENT)
            .build()
            .into();
        UreqHttp { agent }
    }
}

impl Http for UreqHttp {
    fn get(&mut self, url: &str) -> Result<(u16, String), String> {
        let mut response = self
            .agent
            .get(url)
            .header("Accept", "application/json")
            .call()
            .map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .read_to_string()
            .map_err(|e| e.to_string())?;
        Ok((status, body))
    }
}

pub struct Client<H: Http> {
    http: H,
    sleep: fn(Duration),
}

impl<H: Http> Client<H> {
    pub fn new(http: H) -> Self {
        Client {
            http,
            sleep: thread::sleep,
        }
    }

    pub fn with_sleep(http: H, sleep: fn(Duration)) -> Self {
        Client { http, sleep }
    }

    fn get_json(&mut self, url: &str) -> Result<Value, ChessComError> {
        let mut retried = false;
        loop {
            let (status, body) = self.http.get(url).map_err(|_| ChessComError::Unavailable)?;
            match status {
                404 => return Err(ChessComError::NotFound),
                429 if !retried => {
                    retried = true;
                    (self.sleep)(RATE_LIMIT_RETRY);
                }
                429 => return Err(ChessComError::RateLimited),
                200..=299 => {
                    return serde_json::from_str(&body).map_err(|_| ChessComError::BadResponse);
                }
                _ => return Err(ChessComError::Unavailable),
            }
        }
    }

    pub fn archives(&mut self, username: &str) -> Result<Vec<String>, ChessComError> {
        let url = format!("{API_BASE}{}/games/archives", encode_component(username));
        parse_archives(&self.get_json(&url)?)
    }

    pub fn month(&mut self, archive_url: &str) -> Result<Vec<GameSummary>, ChessComError> {
        if !is_archive_url(archive_url) {
            return Err(ChessComError::BadResponse);
        }
        parse_month(&self.get_json(archive_url)?)
    }

    /// Mois le plus récent qui contient des parties, en examinant au plus 3 mois. Si tous sont
    /// vides, `index` désigne le plus ancien mois examiné (on peut encore remonter) ; -1 sans archive.
    pub fn latest_games(&mut self, username: &str) -> Result<LatestGames, ChessComError> {
        let archives = self.archives(username)?;
        let oldest = archives.len().saturating_sub(MAX_EMPTY_MONTHS_SKIPPED);
        for index in (oldest..archives.len()).rev() {
            let games = self.month(&archives[index])?;
            if !games.is_empty() {
                return Ok(LatestGames {
                    index: index as i64,
                    games,
                    archives,
                });
            }
        }
        let index = if archives.is_empty() {
            -1
        } else {
            oldest as i64
        };
        Ok(LatestGames {
            archives,
            index,
            games: Vec::new(),
        })
    }
}

#[derive(Clone, Debug)]
pub struct LatestGames {
    pub archives: Vec<String>,
    pub index: i64,
    pub games: Vec<GameSummary>,
}

fn encode_component(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------------------
// Thread des requêtes.

pub enum ApiRequest {
    Search {
        generation: u64,
        username: String,
    },
    Month {
        generation: u64,
        url: String,
        index: usize,
    },
}

pub enum ApiEvent {
    Search {
        generation: u64,
        username: String,
        result: Result<LatestGames, ChessComError>,
    },
    Month {
        generation: u64,
        index: usize,
        result: Result<Vec<GameSummary>, ChessComError>,
    },
}

pub struct ApiService {
    requests: Sender<ApiRequest>,
    pub events: Receiver<ApiEvent>,
}

impl ApiService {
    pub fn spawn(notify: impl Fn() + Send + 'static) -> ApiService {
        let (requests, inbox) = mpsc::channel::<ApiRequest>();
        let (outbox, events) = mpsc::channel::<ApiEvent>();
        thread::Builder::new()
            .name("chess.com".into())
            .spawn(move || {
                let mut client = Client::new(UreqHttp::default());
                for request in inbox {
                    let event = match request {
                        ApiRequest::Search {
                            generation,
                            username,
                        } => {
                            let result = client.latest_games(&username);
                            ApiEvent::Search {
                                generation,
                                username,
                                result,
                            }
                        }
                        ApiRequest::Month {
                            generation,
                            url,
                            index,
                        } => ApiEvent::Month {
                            generation,
                            index,
                            result: client.month(&url),
                        },
                    };
                    if outbox.send(event).is_err() {
                        return;
                    }
                    notify();
                }
            })
            .expect("thread chess.com");
        ApiService { requests, events }
    }

    pub fn send(&self, request: ApiRequest) {
        let _ = self.requests.send(request);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeHttp(HashMap<String, Vec<(u16, String)>>, Vec<String>);

    impl Http for FakeHttp {
        fn get(&mut self, url: &str) -> Result<(u16, String), String> {
            self.1.push(url.to_string());
            let queue = self.0.get_mut(url).ok_or("URL inattendue")?;
            Ok(if queue.len() > 1 {
                queue.remove(0)
            } else {
                queue[0].clone()
            })
        }
    }

    fn month(m: &str) -> String {
        format!("https://api.chess.com/pub/player/testeur/games/2026/{m}")
    }
    const ARCHIVES: &str = "https://api.chess.com/pub/player/testeur/games/archives";

    #[test]
    fn pseudos() {
        assert_eq!(validate_username("  Magnus_C-1 "), Ok("magnus_c-1".into()));
        for bad in [
            "",
            "ab",
            &"a".repeat(26),
            "jean dupont",
            "é_lève",
            "x/../y",
            "pseudo?",
        ] {
            assert!(validate_username(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn decompte_des_coups() {
        assert_eq!(
            count_moves("[Event \"Coupe ] 12. ronde\"]\n\n1. e4 {[%clk 0:03:00]} e5 2. Nf3 *"),
            2
        );
        assert_eq!(count_moves("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4... Nf6 *"), 3);
    }

    #[test]
    fn trois_mois_vides() {
        let archives: Vec<String> = ["08", "09", "10", "11", "12"]
            .iter()
            .map(|m| month(m))
            .collect();
        let mut routes = HashMap::new();
        routes.insert(
            ARCHIVES.to_string(),
            vec![(200, serde_json::json!({ "archives": archives }).to_string())],
        );
        for m in ["10", "11", "12"] {
            routes.insert(month(m), vec![(200, r#"{"games":[]}"#.to_string())]);
        }
        let mut client = Client::with_sleep(FakeHttp(routes, Vec::new()), |_| {});
        let result = client.latest_games("testeur").unwrap();
        assert_eq!((result.index, result.games.len()), (2, 0));
    }

    #[test]
    fn deux_429_puis_echec_et_404() {
        let mut routes = HashMap::new();
        routes.insert(ARCHIVES.to_string(), vec![(429, String::new())]);
        let mut client = Client::with_sleep(FakeHttp(routes, Vec::new()), |_| {});
        assert_eq!(client.archives("testeur"), Err(ChessComError::RateLimited));
        assert_eq!(client.http.1.len(), 2);

        let mut routes = HashMap::new();
        routes.insert(ARCHIVES.to_string(), vec![(404, String::new())]);
        let mut client = Client::with_sleep(FakeHttp(routes, Vec::new()), |_| {});
        assert_eq!(client.archives("testeur"), Err(ChessComError::NotFound));
    }

    #[test]
    fn adresses_d_archive() {
        assert!(is_archive_url(&month("10")));
        assert!(!is_archive_url(
            "https://api.chess.com/pub/player/x/../../titled/GM"
        ));
        assert!(!is_archive_url("https://evil.example/x"));
    }
}
