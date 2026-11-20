# Lanceur local de ChessAnalyser (installe par installer/ChessAnalyser.iss).
# Sert le site statique (dossier "site" a cote de ce script) sur http://localhost:51730/
# puis ouvre le navigateur. Le serveur s'arrete seul apres 15 minutes sans requete.
# Si le port est deja occupe par ChessAnalyser (lanceur deja actif), ouvre simplement le
# navigateur ; s'il est occupe par un autre programme, affiche une erreur.
$ErrorActionPreference = 'Stop'
$port = 51730
$prefix = "http://localhost:$port/"
$root = Join-Path $PSScriptRoot 'site'
$idleLimit = [TimeSpan]::FromMinutes(15)
# En-tete qui permet a une seconde instance de reconnaitre le serveur de ChessAnalyser.
$marker = 'X-ChessAnalyser'

$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.mjs' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.json' = 'application/json'; '.wasm' = 'application/wasm'; '.svg' = 'image/svg+xml'
    '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
    '.woff2' = 'font/woff2'; '.woff' = 'font/woff'
}

function Test-ChessAnalyserServer {
    try {
        $probe = Invoke-WebRequest -Uri $prefix -Method Head -UseBasicParsing -TimeoutSec 3
        return [bool]$probe.Headers[$marker]
    } catch {
        return $false
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    if (Test-ChessAnalyserServer) {
        Start-Process $prefix
        exit 0
    }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "Le port $port est deja utilise par un autre programme. Fermez ce programme puis relancez ChessAnalyser.",
        'ChessAnalyser', 'OK', 'Error') | Out-Null
    exit 1
}
Start-Process $prefix

# Separateur final : sans lui, un dossier voisin comme "site2" passerait le controle.
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$index = Join-Path $rootFull 'index.html'
$last = [DateTime]::UtcNow
while ($listener.IsListening) {
    $pending = $listener.BeginGetContext($null, $null)
    while (-not $pending.AsyncWaitHandle.WaitOne(1000)) {
        if (([DateTime]::UtcNow - $last) -gt $idleLimit) { $listener.Stop(); exit 0 }
    }
    $ctx = $listener.EndGetContext($pending)
    $last = [DateTime]::UtcNow
    $req = $ctx.Request
    $res = $ctx.Response
    try {
        $res.AddHeader($marker, '1')
        $res.AddHeader('X-Content-Type-Options', 'nosniff')
        # Seul l'hote localhost est servi (protection contre le DNS rebinding).
        if ($req.Url.Host -ne 'localhost') {
            $res.StatusCode = 403
            continue
        }
        if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') {
            $res.StatusCode = 405
            $res.AddHeader('Allow', 'GET, HEAD')
            continue
        }
        $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
        if ($rel -eq '') { $rel = 'index.html' }
        $path = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))
        if (-not $path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
            # Application monopage : toute route inconnue renvoie index.html
            $path = $index
        }
        $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $res.ContentLength64 = $bytes.Length
        if ($req.HttpMethod -eq 'GET') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    } catch {
        $res.StatusCode = 500
    } finally {
        $res.Close()
    }
}
