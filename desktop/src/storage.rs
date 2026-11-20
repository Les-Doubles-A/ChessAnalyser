//! Préférences locales (dernier pseudo, préréglage), dans le dossier de configuration de
//! l'utilisateur. Sans dossier accessible, l'application fonctionne sans rien mémoriser.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::engine::Preset;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<Preset>,
}

fn prefs_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("", "Les-Doubles-A", "ChessAnalyser")
        .map(|dirs| dirs.config_dir().join("prefs.json"))
}

pub fn load_prefs() -> Prefs {
    prefs_path().map_or_else(Prefs::default, |path| load_from(&path))
}

pub fn load_from(path: &std::path::Path) -> Prefs {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .map(|value| Prefs {
            last_username: value
                .get("lastUsername")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            preset: value
                .get("preset")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
        })
        .unwrap_or_default()
}

/// Met à jour les préférences données et conserve les autres.
pub fn save_prefs(update: Prefs) {
    if let Some(path) = prefs_path() {
        save_to(&path, update);
    }
}

pub fn save_to(path: &std::path::Path, update: Prefs) {
    let current = load_from(path);
    let merged = Prefs {
        last_username: update.last_username.or(current.last_username),
        preset: update.preset.or(current.preset),
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(&merged) {
        let _ = std::fs::write(path, text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fusionne_et_ignore_l_invalide() {
        let dir = std::env::temp_dir().join(format!("chessanalyser-prefs-{}", std::process::id()));
        let path = dir.join("prefs.json");
        save_to(
            &path,
            Prefs {
                last_username: Some("testeur".into()),
                preset: None,
            },
        );
        save_to(
            &path,
            Prefs {
                last_username: None,
                preset: Some(Preset::Deep),
            },
        );
        assert_eq!(
            load_from(&path),
            Prefs {
                last_username: Some("testeur".into()),
                preset: Some(Preset::Deep)
            }
        );
        std::fs::write(&path, r#"{"lastUsername": 42, "preset": "ultra"}"#).unwrap();
        assert_eq!(load_from(&path), Prefs::default());
        std::fs::write(&path, "{pas du json").unwrap();
        assert_eq!(load_from(&path), Prefs::default());
        let _ = std::fs::remove_dir_all(dir);
    }
}
