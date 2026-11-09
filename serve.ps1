# Kleiner lokaler Webserver fuer die Vereinsorga-App (ohne Python/Node).
# Start:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080] [-Open]
# -Open oeffnet die App im Browser, sobald der Server bereit ist.
param([int]$Port = 8080, [switch]$Open)
$root = $PSScriptRoot
$url = "http://localhost:$Port/"
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.webmanifest'='application/manifest+json'; '.svg'='image/svg+xml'; '.png'='image/png'; '.json'='application/json' }

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($url)
try {
  $listener.Start()
} catch {
  Write-Host "Der Server konnte nicht starten: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Vermutlich laeuft er schon in einem anderen Fenster. Dann einfach $url im Browser oeffnen."
  if ($Open) { Start-Process $url }
  exit 1
}

Write-Host "Vereinsorga-Server laeuft auf $url"
Write-Host "Zum Beenden dieses Fenster schliessen (oder Strg+C)."
if ($Open) { Start-Process $url }

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq '') { $path = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $path))
    if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full)
      $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
    $ctx.Response.Close()
  } catch {
    # Abgebrochene Anfragen (z. B. Tab geschlossen) duerfen den Server nicht beenden.
  }
}
