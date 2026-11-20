//! L'installeur de bureau porte la version de Cargo.toml.

#[test]
fn installeur_a_la_version_du_paquet() {
    let iss = include_str!("../../installer/ChessAnalyserDesktop.iss");
    let expected = format!("#define MyAppVersion \"{}\"", env!("CARGO_PKG_VERSION"));
    assert!(iss.contains(&expected), "installer/ChessAnalyserDesktop.iss : {expected} attendu");
}
