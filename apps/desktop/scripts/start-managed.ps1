param(
    [string]$ServiceUrl = 'http://127.0.0.1:3100'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$desktopRoot = Join-Path $projectRoot 'apps\desktop'
$nodeExecutable = Join-Path $projectRoot '.cache\runtime\node-v22.23.1-win-x64\node.exe'
if (!(Test-Path -LiteralPath $nodeExecutable)) {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
}
$env:PATH = "$(Split-Path $nodeExecutable);$env:PATH"

$origin = [uri]$ServiceUrl
if (!$origin.IsAbsoluteUri -or $origin.UserInfo -or $origin.Query -or $origin.Fragment -or
    $origin.AbsolutePath -ne '/' -or
    ($origin.Scheme -ne 'https' -and !($origin.Scheme -eq 'http' -and $origin.Host -in @('127.0.0.1', 'localhost', '[::1]')))) {
    throw 'Use an HTTPS platform origin. HTTP is allowed only on localhost.'
}
$ServiceUrl = $origin.GetLeftPart([System.UriPartial]::Authority)
try {
    $health = Invoke-RestMethod -Uri "$ServiceUrl/health" -TimeoutSec 8
    if ($health.service -ne 'pilotdeck-platform' -or $health.status -ne 'ok') {
        throw 'The address is not a PilotDeck platform.'
    }
} catch {
    throw "Cannot connect to the account platform at $ServiceUrl. Start the platform first, then retry."
}

foreach ($required in @('dist\src\cli\pilotdeck.js', 'ui\dist\index.html')) {
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot $required))) {
        throw "Missing build: $required. Build the core and Web UI before starting the customer client."
    }
}
Push-Location $desktopRoot
try {
    & $nodeExecutable 'node_modules\typescript\bin\tsc' '-p' 'tsconfig.json'
    if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed.' }
    $electron = & $nodeExecutable '-e' "process.stdout.write(require('electron'))"
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $electron)) {
        throw 'Electron runtime is missing. Install desktop dependencies and run node apps/desktop/node_modules/electron/install.js.'
    }
    $stateDirectory = Join-Path $projectRoot '.pilotdeck\client'
    New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
    $userData = Join-Path $stateDirectory 'user-data'
    $existing = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
        Where-Object { $_.ExecutablePath -eq $electron -and
            $_.CommandLine.Contains("--user-data-dir=`"$userData`"") -and
            $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
    $env:PILOTDECK_MANAGED_URL = $ServiceUrl
    $env:PILOTDECK_DESKTOP_NODE = $nodeExecutable
    # Source checkout startup needs the existing tsx loader; this override is
    # reserved by the desktop runtime for a fully staged JavaScript bundle.
    Remove-Item Env:PILOTDECK_DESKTOP_RUNTIME_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $logId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $client = Start-Process -FilePath $electron `
        -ArgumentList @("`"$desktopRoot`"", "--user-data-dir=`"$userData`"") `
        -WorkingDirectory $projectRoot -WindowStyle Normal -PassThru `
        -RedirectStandardOutput (Join-Path $stateDirectory "$logId.stdout.log") `
        -RedirectStandardError (Join-Path $stateDirectory "$logId.stderr.log")
    $clientId = if ($existing) { $existing.ProcessId } else { $client.Id }
    @{ pid = $clientId; platform = $ServiceUrl; startedAt = (Get-Date).ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDirectory 'service.json') -Encoding UTF8
    Write-Output "PilotDeck customer client launched. Platform: $ServiceUrl"
    Write-Output "Local customer data and logs: $stateDirectory"
} finally {
    Pop-Location
}
