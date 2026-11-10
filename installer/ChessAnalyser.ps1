# Lanceur local de ChessAnalyser (installe par installer/ChessAnalyser.iss).
# Sert le site statique (dossier "site" a cote de ce script) sur http://localhost:51730/
# puis ouvre le navigateur. Le serveur s'arrete seul apres 15 minutes sans requete.
# Si le port est deja occupe (lanceur deja actif), ouvre simplement le navigateur.
$ErrorActionPreference = 'Stop'
$port = 51730
$prefix = "http://localhost:$port/"
$root = Join-Path $PSScriptRoot 'site'
$idleLimit = [TimeSpan]::FromMinutes(15)

$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.mjs' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.json' = 'application/json'; '.wasm' = 'application/wasm'; '.svg' = 'image/svg+xml'
    '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
    '.woff2' = 'font/woff2'; '.woff' = 'font/woff'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    Start-Process $prefix
    exit 0
}
Start-Process $prefix

$rootFull = [System.IO.Path]::GetFullPath($root)
$last = [DateTime]::UtcNow
while ($listener.IsListening) {
    $pending = $listener.BeginGetContext($null, $null)
    while (-not $pending.AsyncWaitHandle.WaitOne(1000)) {
        if (([DateTime]::UtcNow - $last) -gt $idleLimit) { $listener.Stop(); exit 0 }
    }
    $ctx = $listener.EndGetContext($pending)
    $last = [DateTime]::UtcNow
    $res = $ctx.Response
    try {
        $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
        if ($rel -eq '') { $rel = 'index.html' }
        $path = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))
        if (-not $path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
            # Application monopage : toute route inconnue renvoie index.html
            $path = Join-Path $rootFull 'index.html'
        }
        $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $res.StatusCode = 500
    } finally {
        $res.Close()
    }
}
