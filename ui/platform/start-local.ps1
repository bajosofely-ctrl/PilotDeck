$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$node = Join-Path $projectRoot '.cache\runtime\node-v22.23.1-win-x64\node.exe'
$entry = Join-Path $PSScriptRoot 'server\index.js'
$data = Join-Path $projectRoot '.pilotdeck\platform'
$environment = Join-Path $data 'platform.env'
if (!(Test-Path -LiteralPath $environment)) { throw 'Run node ui/platform/setup.mjs --local first.' }
if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'admin\dist\index.html'))) { throw 'Build the admin UI first.' }
$statePath = Join-Path $data 'service.json'
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)"
    if ($existing -and $existing.ExecutablePath -eq $node -and $existing.CommandLine.Contains($entry)) {
        Write-Output "Platform already running: $($state.url)"
        exit 0
    }
}
$selectedPort = 0
foreach ($candidate in 3100..3120) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
    try { $listener.Start(); $selectedPort = $candidate; break }
    catch [Net.Sockets.SocketException] { continue }
    finally { $listener.Stop() }
}
if (!$selectedPort) { throw 'No free platform port.' }
$env:PLATFORM_PORT = [string]$selectedPort
$env:PLATFORM_HOST = '127.0.0.1'
$service = Start-Process -FilePath $node -ArgumentList @("--env-file=`"$environment`"", "`"$entry`"") `
    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $data 'stdout.log') -RedirectStandardError (Join-Path $data 'stderr.log')
$url = "http://127.0.0.1:$selectedPort"
@{ pid = $service.Id; url = $url } | ConvertTo-Json | Set-Content -LiteralPath $statePath
foreach ($attempt in 1..30) {
    $service.Refresh()
    if ($service.HasExited) { throw "Platform exited. Check $data\stderr.log" }
    try {
        $health = Invoke-RestMethod "$url/health" -TimeoutSec 2
        if ($health.service -eq 'pilotdeck-platform') { Write-Output "Platform ready: $url"; exit 0 }
    } catch { Start-Sleep -Milliseconds 500 }
}
throw 'Platform did not become healthy.'
