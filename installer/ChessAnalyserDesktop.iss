; Installeur Inno Setup de l'application de bureau (Rust, desktop/).
; Prealables : desktop\fetch-stockfish.ps1, puis `cargo build --release` dans desktop\.
; Compilation : iscc installer\ChessAnalyserDesktop.iss
; Le setup est cree dans installer\Output\ChessAnalyser-Desktop-Setup-0.2.0.exe
#define MyAppName "ChessAnalyser"
#define MyAppVersion "0.2.0"
#define MyAppURL "https://github.com/Les-Doubles-A/ChessAnalyser"

[Setup]
; Identifiant distinct de la version web (ChessAnalyser.iss) : les deux peuvent coexister.
AppId={{BC6179F6-7309-432A-85B3-970A7D82058D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion} (application de bureau)
AppPublisher=Les-Doubles-A
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyAppName} Desktop
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=Output
OutputBaseFilename={#MyAppName}-Desktop-Setup-{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
SetupIconFile=ChessAnalyser.ico
UninstallDisplayIcon={app}\ChessAnalyser.exe
LicenseFile=..\LICENSE

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\desktop\target\release\chessanalyser.exe"; DestDir: "{app}"; DestName: "ChessAnalyser.exe"; Flags: ignoreversion
Source: "..\desktop\engine\stockfish.exe"; DestDir: "{app}\engine"; Flags: ignoreversion
Source: "..\desktop\engine\COPYING-stockfish.txt"; DestDir: "{app}\engine"; Flags: ignoreversion
Source: "..\desktop\assets\pieces\LICENSE.md"; DestDir: "{app}"; DestName: "LICENSE-pieces.md"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "ChessAnalyser.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\ChessAnalyser.exe"; IconFilename: "{app}\ChessAnalyser.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\ChessAnalyser.exe"; IconFilename: "{app}\ChessAnalyser.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\ChessAnalyser.exe"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
