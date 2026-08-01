$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$root = Get-AuroraRoot
Assert-AuroraRoot $root
$bootstrapFile = $null
function Open-AuroraAuthenticatedSession([string]$CleanUrl) {
    $candidate = Join-Path $root "data\logs\.aurora-session-$PID.html"
    & $node (Join-Path $root 'scripts\session-bootstrap.mjs') $CleanUrl $candidate
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Kunde inte skapa säker webbläsarsession. Stoppa och starta Aurora igen. / Could not create a safe browser session. Stop and restart Aurora.' }
    $script:bootstrapFile = $candidate
    try {
        Start-Process -FilePath $candidate | Out-Null
        # A cold browser can outlive the launcher; retain the private bootstrap
        # briefly, then remove its only on-disk copy.
        Start-Sleep -Seconds 10
    } finally {
        Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
        $script:bootstrapFile = $null
    }
}
$appOverride = $null
$llmOverride = $null
$openBrowser = $true
$allowUnverifiedModel = $false
for ($index = 0; $index -lt $args.Count; $index++) {
    switch ($args[$index]) {
        '--port' { if (++$index -ge $args.Count) { Stop-Aurora '--port kräver ett värde. / --port requires a value.' }; $appOverride = $args[$index] }
        '--llm-port' { if (++$index -ge $args.Count) { Stop-Aurora '--llm-port kräver ett värde. / --llm-port requires a value.' }; $llmOverride = $args[$index] }
        '--no-open' { $openBrowser = $false }
        '--allow-unverified-model' { $allowUnverifiedModel = $true }
        '-h' { Write-Host 'Usage: scripts\start.ps1 [--port PORT] [--llm-port PORT] [--no-open] [--allow-unverified-model]'; exit 0 }
        '--help' { Write-Host 'Usage: scripts\start.ps1 [--port PORT] [--llm-port PORT] [--no-open] [--allow-unverified-model]'; exit 0 }
        default { Stop-Aurora "Okänt argument: $($args[$index]) / Unknown argument" }
    }
}

$node = Get-AuroraNode $root
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $root '.runtime\install.json') -PathType Leaf)) {
    Stop-Aurora 'Aurora är inte byggt. Kör build.bat först. / Aurora is not built. Run build.bat first.'
}
Initialize-AuroraMutableLayout $root
Assert-AuroraLocalConfigSafe $root
$logs = Join-Path $root 'data\logs'
$supervisorPid = Get-AuroraPidFile (Join-Path $logs 'supervisor.pid')
if ($null -ne $supervisorPid -and (Test-AuroraPid $supervisorPid) -and (Test-AuroraOwnedProcess $supervisorPid $root 'supervisor.mjs')) {
    $stateFile = Join-Path $logs 'state.json'
    $url = "http://127.0.0.1:$(Get-AuroraConfig $root 'appPort')"
    if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
        try {
            $candidateUrl = Get-AuroraSafeLoopbackUrl "$(Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json | Select-Object -ExpandProperty url)"
            if ($null -ne $candidateUrl) { $url = $candidateUrl }
            else { Write-AuroraWarning 'Ogiltig state-URL ignorerades. / Invalid state URL was ignored.' }
        } catch { Write-AuroraWarning 'Ogiltig state-fil ignorerades. / Invalid state file was ignored.' }
    }
    Write-AuroraInfo "Aurora körs redan: $url / Aurora is already running: $url"
    if ($openBrowser) { Open-AuroraAuthenticatedSession $url }
    exit 0
}
if ($null -ne $supervisorPid -and (Test-AuroraPid $supervisorPid)) { Write-AuroraWarning 'PID-filen pekar inte på Auroras supervisor och ignoreras. / PID file does not point to Aurora supervisor and was ignored.' }

$requestedApp = if ($null -ne $appOverride) { $appOverride } else { Get-AuroraConfig $root 'appPort' }
$requestedLlm = if ($null -ne $llmOverride) { $llmOverride } else { Get-AuroraConfig $root 'llmPort' }
$appNumber = 0; $llmNumber = 0
if (-not [int]::TryParse("$requestedApp", [ref]$appNumber) -or $appNumber -lt 1 -or $appNumber -gt 65535) { Stop-Aurora 'Ogiltig app-port. / Invalid app port.' }
if (-not [int]::TryParse("$requestedLlm", [ref]$llmNumber) -or $llmNumber -lt 1 -or $llmNumber -gt 65535) { Stop-Aurora 'Ogiltig LLM-port. / Invalid LLM port.' }
$appPort = (& $node (Join-Path $root 'scripts\port-utils.mjs') $appNumber).Trim()
$llmPort = (& $node (Join-Path $root 'scripts\port-utils.mjs') $llmNumber $appPort).Trim()
if ($appPort -ne "$appNumber") { Write-AuroraWarning "Port $appNumber var upptagen; använder $appPort. / Port was busy; using $appPort." }
if ($llmPort -ne "$llmNumber") { Write-AuroraWarning "LLM-port $llmNumber var upptagen; använder $llmPort. / LLM port was busy; using $llmPort." }

$llama = Get-AuroraLlama $root
if ($null -eq $llama) { Stop-Aurora 'llama-server saknas i .runtime. Kör build igen. / llama-server is missing from .runtime. Run build again.' }
$modelRelative = Get-AuroraConfig $root 'modelPath'
$model = (& $node (Join-Path $root 'scripts\config-cli.mjs') model).Trim()
if (-not (Test-Path -LiteralPath $model -PathType Leaf)) { Stop-Aurora "Vald GGUF-modell saknas: $modelRelative / Selected GGUF model is missing." }
$modelItem = Get-Item -LiteralPath $model -Force
if (($modelItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Aurora 'Vald GGUF-modell får inte vara en länk/junction. / Selected GGUF model must not be a link or junction.' }
$modelsRoot = [IO.Path]::GetFullPath((Join-Path $root 'llm\models'))
$modelFull = [IO.Path]::GetFullPath($model)
if (-not $modelFull.StartsWith("$modelsRoot\", [StringComparison]::OrdinalIgnoreCase)) { Stop-Aurora 'Vald modell ligger utanför llm\models. / Selected model is outside llm/models.' }
$modelManifestRelative = $modelFull.Substring($root.Length + 1).Replace('\','/')
if ((Test-AuroraManifestPath $root $modelManifestRelative) -and (Test-AuroraLockedModelPath $root $modelManifestRelative)) { }
elseif ($allowUnverifiedModel) {
    Write-AuroraWarning "OVERIFIERAD MODELL TILLÅTS UTTRYCKLIGEN: $modelManifestRelative / UNVERIFIED MODEL EXPLICITLY ALLOWED."
    Write-AuroraWarning 'GGUF är native-parserindata. Kör endast i organisationens godkända OS-sandbox och verifiera proveniens. / GGUF is native-parser input. Use an approved OS sandbox and verify provenance.'
} else {
    Stop-Aurora "Vald modell är inte en manifestverifierad kind=model-artefakt: $modelManifestRelative. Välj den pinnade modellen eller starta uttryckligen med --allow-unverified-model i en godkänd sandbox. / Selected model is not a manifest-verified kind=model artifact. Select the pinned model or explicitly use --allow-unverified-model in an approved sandbox."
}
foreach ($name in @('supervisor.log','app.log','llama.log','server.log')) { Reset-AuroraLogFile (Join-Path $logs $name) }
foreach ($name in @('supervisor.pid','app.pid','llama.pid')) { Remove-Item -LiteralPath (Join-Path $logs $name) -Force -ErrorAction SilentlyContinue }

$supervisorArgs = @(
    ('"{0}"' -f (Join-Path $root 'scripts\supervisor.mjs')),
    '--root', ('"{0}"' -f $root),
    '--node', ('"{0}"' -f $node),
    '--server', ('"{0}"' -f (Join-Path $root 'server\index.mjs')),
    '--llama', ('"{0}"' -f $llama),
    '--model', ('"{0}"' -f $model),
    '--app-port', $appPort,
    '--llm-port', $llmPort,
    '--data-dir', ('"{0}"' -f (Join-Path $root 'data')),
    '--context-size', (Get-AuroraConfig $root 'llm.contextSize'),
    '--seed', (Get-AuroraConfig $root 'llm.seed')
)
$launcher = Start-Process -FilePath $node -ArgumentList $supervisorArgs -WorkingDirectory $root -WindowStyle Hidden -PassThru
$url = "http://127.0.0.1:$appPort"
& $node (Join-Path $root 'scripts\wait-for-http.mjs') "$url/api/health" 90000
if ($LASTEXITCODE -ne 0) {
    Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue
    Stop-Aurora 'Appservern startade inte. Se data\logs\app.log och supervisor.log. / App server did not start. See the logs.'
}
Write-AuroraInfo "Aurora Intel: $url"
Write-AuroraInfo 'Endast denna dator kan ansluta (127.0.0.1). / Only this computer can connect (127.0.0.1).'
if ($openBrowser) { Open-AuroraAuthenticatedSession $url }
