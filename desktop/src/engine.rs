//! Stockfish natif : dialogue UCI (portage de `src/engine/uci.ts`) et service d'analyse dans
//! un thread dédié. Une seule recherche à la fois ; les évaluations des variantes passent
//! entre deux positions de l'analyse de la partie.

use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;

use crate::chess::{Color, Terminal, terminal_kind};

/// Score du point de vue des blancs. `mate: 0` désigne une position déjà matée.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Score {
    Cp(i32),
    Mate { mate: u32, winner: Color },
}

/// Format JSON des scripts Node : `{ "cp": 30 }` ou `{ "mate": 3, "winner": "b" }`.
#[derive(Deserialize)]
#[serde(untagged)]
enum ScoreJson {
    Cp { cp: i32 },
    Mate { mate: u32, winner: String },
}

impl<'de> Deserialize<'de> for Score {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match ScoreJson::deserialize(deserializer)? {
            ScoreJson::Cp { cp } => Score::Cp(cp),
            ScoreJson::Mate { mate, winner } => Score::Mate {
                mate,
                winner: if winner == "w" {
                    Color::White
                } else {
                    Color::Black
                },
            },
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PositionEval {
    pub fen: String,
    /// 0 pour une position finale évaluée sans moteur.
    pub depth: u32,
    pub score: Score,
    pub best_move_uci: Option<String>,
    pub pv: Vec<String>,
}

/// Préréglages (ADR-2) : profondeurs fixes, identiques au site et à la calibration.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Standard,
    Deep,
}

impl Preset {
    pub fn depth(self) -> u32 {
        match self {
            Preset::Standard => 14,
            Preset::Deep => 18,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Preset::Standard => "standard",
            Preset::Deep => "deep",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Preset::Standard => "Standard",
            Preset::Deep => "profonde",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct InfoLine {
    pub depth: u32,
    /// Score du point de vue du camp au trait, comme le renvoie UCI.
    pub score: RawScore,
    pub pv: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RawScore {
    Cp(i32),
    Mate(i32),
}

/// Lit une ligne `info … score …`. Ignore les bornes et les lignes secondaires (multipv > 1).
pub fn parse_info(line: &str) -> Option<InfoLine> {
    if !line.starts_with("info ") || line.contains(" lowerbound") || line.contains(" upperbound") {
        return None;
    }
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let at = |name: &str| tokens.iter().position(|t| *t == name);
    let depth: u32 = tokens.get(at("depth")? + 1)?.parse().ok()?;
    let score_at = at("score")?;
    let value: i32 = tokens.get(score_at + 2)?.parse().ok()?;
    let score = match *tokens.get(score_at + 1)? {
        "cp" => RawScore::Cp(value),
        "mate" => RawScore::Mate(value),
        _ => return None,
    };
    if let Some(multipv) = at("multipv")
        && tokens.get(multipv + 1) != Some(&"1")
    {
        return None;
    }
    let pv = at("pv").map_or_else(Vec::new, |i| {
        tokens[i + 1..].iter().map(|s| s.to_string()).collect()
    });
    Some(InfoLine { depth, score, pv })
}

/// Score UCI (camp au trait) vers le point de vue des blancs.
pub fn to_white_score(score: RawScore, side_to_move: Color) -> Score {
    match score {
        RawScore::Cp(cp) => Score::Cp(if side_to_move == Color::White {
            cp
        } else {
            -cp
        }),
        RawScore::Mate(mate) => {
            let mover_wins = mate > 0;
            let winner = if mover_wins == (side_to_move == Color::White) {
                Color::White
            } else {
                Color::Black
            };
            Score::Mate {
                mate: mate.unsigned_abs(),
                winner,
            }
        }
    }
}

/// Évaluation sans moteur des positions finales (mat ou pat).
pub fn terminal_eval(fen: &str) -> Option<PositionEval> {
    let score = match terminal_kind(fen)? {
        Terminal::Checkmate { winner } => Score::Mate { mate: 0, winner },
        Terminal::Stalemate => Score::Cp(0),
    };
    Some(PositionEval {
        fen: fen.to_string(),
        depth: 0,
        score,
        best_move_uci: None,
        pv: Vec::new(),
    })
}

const START_TIMEOUT: Duration = Duration::from_secs(20);
/// Très au-delà d'une recherche à profondeur 18 : ne sert qu'à détecter un moteur figé.
const EVAL_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq)]
pub enum EngineError {
    NotFound(PathBuf),
    Start(String),
    Timeout,
    Crashed(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::NotFound(path) => {
                write!(
                    f,
                    "Le moteur d’analyse est introuvable ({}).",
                    path.display()
                )
            }
            EngineError::Start(why) => {
                write!(f, "Le moteur d’analyse n’a pas pu démarrer ({why}).")
            }
            EngineError::Timeout => write!(f, "Le moteur d’analyse ne répond plus."),
            EngineError::Crashed(why) => write!(f, "Le moteur d’analyse s’est arrêté ({why})."),
        }
    }
}

/// Processus Stockfish et lecture de ses lignes.
pub struct EngineProcess {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl EngineProcess {
    pub fn start(path: &std::path::Path) -> Result<EngineProcess, EngineError> {
        if !path.exists() {
            return Err(EngineError::NotFound(path.to_path_buf()));
        }
        let mut command = Command::new(path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| EngineError::Start(e.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| EngineError::Start("entrée indisponible".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| EngineError::Start("sortie indisponible".into()))?;
        let (tx, lines) = mpsc::channel();
        thread::Builder::new()
            .name("stockfish-sortie".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| EngineError::Start(e.to_string()))?;
        let mut engine = EngineProcess {
            child,
            stdin,
            lines,
        };
        engine.send("uci")?;
        engine
            .wait_for("uciok", START_TIMEOUT)
            .map_err(|_| EngineError::Start("pas de réponse UCI".into()))?;
        // Un seul fil et 16 Mo de table : résultats reproductibles, comme pour la calibration.
        engine.send("setoption name Threads value 1")?;
        engine.send("setoption name Hash value 16")?;
        engine.send("isready")?;
        engine
            .wait_for("readyok", START_TIMEOUT)
            .map_err(|_| EngineError::Start("pas de readyok".into()))?;
        Ok(engine)
    }

    fn send(&mut self, command: &str) -> Result<(), EngineError> {
        writeln!(self.stdin, "{command}")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| EngineError::Crashed(e.to_string()))
    }

    fn wait_for(&mut self, token: &str, timeout: Duration) -> Result<(), EngineError> {
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.lines.recv_timeout(left) {
                Ok(line) if line.trim() == token => return Ok(()),
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => return Err(EngineError::Timeout),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(EngineError::Crashed("sortie fermée".into()));
                }
            }
        }
    }

    pub fn new_game(&mut self) -> Result<(), EngineError> {
        self.send("ucinewgame")?;
        self.send("isready")?;
        self.wait_for("readyok", START_TIMEOUT)
    }

    /// Évalue `fen` à profondeur fixe. Ok(None) si `cancel` a interrompu la recherche.
    pub fn evaluate(
        &mut self,
        fen: &str,
        depth: u32,
        cancel: &AtomicBool,
    ) -> Result<Option<PositionEval>, EngineError> {
        if cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        self.send(&format!("position fen {fen}"))?;
        self.send(&format!("go depth {depth}"))?;
        let started = Instant::now();
        let mut last: Option<InfoLine> = None;
        let mut stopped = false;
        loop {
            if !stopped && cancel.load(Ordering::Relaxed) {
                self.send("stop")?;
                stopped = true;
            }
            if started.elapsed() > EVAL_TIMEOUT {
                return Err(EngineError::Timeout);
            }
            let line = match self.lines.recv_timeout(Duration::from_millis(25)) {
                Ok(line) => line,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(EngineError::Crashed("sortie fermée".into()));
                }
            };
            if line.starts_with("info ") {
                if let Some(info) = parse_info(&line)
                    && last.as_ref().is_none_or(|l| info.depth >= l.depth)
                {
                    last = Some(info);
                }
            } else if let Some(rest) = line.strip_prefix("bestmove") {
                if stopped {
                    return Ok(None);
                }
                let best = rest
                    .split_whitespace()
                    .next()
                    .filter(|m| *m != "(none)")
                    .map(str::to_string);
                let Some(info) = last else {
                    return Err(EngineError::Crashed(format!(
                        "aucune évaluation pour {fen}"
                    )));
                };
                let side = crate::chess::side_to_move(fen);
                return Ok(Some(PositionEval {
                    fen: fen.to_string(),
                    depth: info.depth,
                    score: to_white_score(info.score, side),
                    best_move_uci: best,
                    pv: info.pv,
                }));
            }
        }
    }
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
        let _ = writeln!(self.stdin, "quit");
        let _ = self.stdin.flush();
        let deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Emplacement de Stockfish : `CHESSANALYSER_STOCKFISH`, sinon `engine\stockfish.exe` à côté
/// de l'exécutable (installation), sinon `desktop/engine/stockfish.exe` (développement).
pub fn default_engine_path() -> PathBuf {
    if let Ok(path) = std::env::var("CHESSANALYSER_STOCKFISH") {
        return PathBuf::from(path);
    }
    let name = if cfg!(windows) {
        "stockfish.exe"
    } else {
        "stockfish"
    };
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
    {
        let installed = dir.join("engine").join(name);
        if installed.exists() {
            return installed;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("engine")
        .join(name)
}

// ---------------------------------------------------------------------------------------
// Service d'analyse.

pub enum Request {
    /// Analyse les positions d'une partie ; remplace l'analyse en cours.
    Analyse {
        id: u64,
        fens: Vec<String>,
        depth: u32,
        cancel: Arc<AtomicBool>,
    },
    /// Évalue les positions d'une variante (la position affichée d'abord) ; remplace la
    /// demande de variante précédente.
    Variation { fens: Vec<String>, depth: u32 },
}

#[derive(Debug, Clone)]
pub enum Event {
    Position {
        id: u64,
        index: usize,
        eval: PositionEval,
    },
    Finished {
        id: u64,
        complete: bool,
    },
    Failed {
        id: u64,
        error: EngineError,
    },
    VariationEval {
        depth: u32,
        eval: PositionEval,
    },
    VariationFailed {
        depth: u32,
        error: EngineError,
    },
}

struct Job {
    id: u64,
    fens: Vec<String>,
    depth: u32,
    cancel: Arc<AtomicBool>,
    next: usize,
    started: bool,
}

/// Point d'entrée de l'interface : envoie des demandes, reçoit des événements.
pub struct EngineService {
    requests: Sender<Request>,
    pub events: Receiver<Event>,
}

impl EngineService {
    /// `notify` est appelé après chaque événement (rafraîchissement de l'interface).
    pub fn spawn(path: PathBuf, notify: impl Fn() + Send + 'static) -> EngineService {
        let (requests, inbox) = mpsc::channel::<Request>();
        let (outbox, events) = mpsc::channel::<Event>();
        thread::Builder::new()
            .name("moteur".into())
            .spawn(move || service_loop(path, inbox, outbox, notify))
            .expect("thread du moteur");
        EngineService { requests, events }
    }

    pub fn send(&self, request: Request) {
        let _ = self.requests.send(request);
    }
}

fn service_loop(path: PathBuf, inbox: Receiver<Request>, outbox: Sender<Event>, notify: impl Fn()) {
    let mut process: Option<EngineProcess> = None;
    let mut job: Option<Job> = None;
    let mut variation: VecDeque<String> = VecDeque::new();
    let mut variation_depth = 0;
    let never = AtomicBool::new(false);
    let emit = |event: Event| {
        let _ = outbox.send(event);
        notify();
    };

    loop {
        // Attend une demande s'il n'y a rien à faire ; sinon relève les demandes en attente.
        let idle = job.is_none() && variation.is_empty();
        let incoming: Vec<Request> = if idle {
            match inbox.recv() {
                Ok(request) => std::iter::once(request).chain(inbox.try_iter()).collect(),
                Err(_) => return,
            }
        } else {
            inbox.try_iter().collect()
        };
        for request in incoming {
            match request {
                Request::Analyse {
                    id,
                    fens,
                    depth,
                    cancel,
                } => {
                    if let Some(old) = job.take() {
                        emit(Event::Finished {
                            id: old.id,
                            complete: false,
                        });
                    }
                    job = Some(Job {
                        id,
                        fens,
                        depth,
                        cancel,
                        next: 0,
                        started: false,
                    });
                }
                Request::Variation { fens, depth } => {
                    variation = fens.into();
                    variation_depth = depth;
                }
            }
        }

        // Variantes d'abord : l'utilisateur attend la position qu'il vient de jouer.
        if let Some(fen) = variation.pop_front() {
            let result = terminal_eval(&fen).map(|e| Ok(Some(e))).unwrap_or_else(|| {
                ensure(&mut process, &path)
                    .and_then(|engine| engine.evaluate(&fen, variation_depth, &never))
            });
            match result {
                Ok(Some(eval)) => emit(Event::VariationEval {
                    depth: variation_depth,
                    eval,
                }),
                Ok(None) => {}
                Err(error) => {
                    process = None;
                    variation.clear();
                    emit(Event::VariationFailed {
                        depth: variation_depth,
                        error,
                    });
                }
            }
            continue;
        }

        let Some(current) = job.as_mut() else {
            continue;
        };
        if current.cancel.load(Ordering::Relaxed) {
            let id = current.id;
            job = None;
            emit(Event::Finished {
                id,
                complete: false,
            });
            continue;
        }
        if current.next >= current.fens.len() {
            let id = current.id;
            job = None;
            emit(Event::Finished { id, complete: true });
            continue;
        }
        let fen = current.fens[current.next].clone();
        let result = match terminal_eval(&fen) {
            Some(eval) => Ok(Some(eval)),
            None => ensure(&mut process, &path).and_then(|engine| {
                if !current.started {
                    engine.new_game()?;
                    current.started = true;
                }
                engine.evaluate(&fen, current.depth, &current.cancel)
            }),
        };
        match result {
            Ok(Some(eval)) => {
                let index = current.next;
                current.next += 1;
                emit(Event::Position {
                    id: current.id,
                    index,
                    eval,
                });
            }
            Ok(None) => {} // annulée : traitée au tour suivant
            Err(error) => {
                let id = current.id;
                job = None;
                process = None; // moteur hors service : un neuf sera démarré à la demande suivante
                emit(Event::Failed { id, error });
            }
        }
    }
}

fn ensure<'a>(
    process: &'a mut Option<EngineProcess>,
    path: &std::path::Path,
) -> Result<&'a mut EngineProcess, EngineError> {
    if process.is_none() {
        *process = Some(EngineProcess::start(path)?);
    }
    Ok(process.as_mut().expect("moteur démarré"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_une_ligne_stockfish() {
        let line = "info depth 14 seldepth 23 multipv 1 score cp -574 nodes 26071 nps 226704 hashfull 9 time 115 pv c4c5 f6e4 f1b5";
        assert_eq!(
            parse_info(line),
            Some(InfoLine {
                depth: 14,
                score: RawScore::Cp(-574),
                pv: vec!["c4c5".into(), "f6e4".into(), "f1b5".into()]
            })
        );
        assert!(parse_info("info depth 12 score cp 30 lowerbound nodes 5 pv e2e4").is_none());
        assert!(parse_info("info string NNUE evaluation").is_none());
        assert!(parse_info("info depth 9 multipv 2 score cp 1 pv e2e4").is_none());
    }

    #[test]
    fn score_du_point_de_vue_des_blancs() {
        assert_eq!(
            to_white_score(RawScore::Cp(50), Color::Black),
            Score::Cp(-50)
        );
        assert_eq!(
            to_white_score(RawScore::Mate(1), Color::Black),
            Score::Mate {
                mate: 1,
                winner: Color::Black
            }
        );
        assert_eq!(
            to_white_score(RawScore::Mate(-2), Color::Black),
            Score::Mate {
                mate: 2,
                winner: Color::White
            }
        );
    }
}
