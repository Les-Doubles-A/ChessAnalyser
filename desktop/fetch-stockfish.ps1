# Telecharge Stockfish 19 (binaire Windows x86-64 "universal", qui choisit seul le code
# optimal pour le processeur) dans desktop\engine\, apres verification de l'empreinte.
# Usage : powershell -ExecutionPolicy Bypass -File desktop\fetch-stockfish.ps1
$ErrorActionPreference = 'Stop'
$url = 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip'
# SHA-256 de l'archive officielle, releve le 2026-11-20.
$expected = '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7'

$engineDir = Join-Path $PSScriptRoot 'engine'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("stockfish-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $work | Out-Null
try {
    $zip = Join-Path $work 'stockfish.zip'
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Empreinte inattendue : $actual" }
    Expand-Archive -Path $zip -DestinationPath $work
    New-Item -ItemType Directory -Force $engineDir | Out-Null
    Copy-Item (Join-Path $work 'stockfish\stockfish-windows-x86-64-universal.exe') (Join-Path $engineDir 'stockfish.exe') -Force
    Copy-Item (Join-Path $work 'stockfish\Copying.txt') (Join-Path $engineDir 'COPYING-stockfish.txt') -Force
    Write-Output "Stockfish 19 installe dans $engineDir"
} finally {
    Remove-Item -Recurse -Force $work
}
