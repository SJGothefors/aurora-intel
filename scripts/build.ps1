$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$root = Get-AuroraRoot
Assert-AuroraRoot $root
$restoreLatest = $false
foreach ($argValue in $args) {
    switch ($argValue) {
        '--restore-latest' { $restoreLatest = $true }
        '-h' { Write-Host 'Usage: scripts\build.ps1 [--restore-latest]'; exit 0 }
        '--help' { Write-Host 'Usage: scripts\build.ps1 [--restore-latest]'; exit 0 }
        default { Stop-Aurora "Okänt argument: $argValue / Unknown argument: $argValue" }
    }
}

Test-AuroraChecksums $root
Assert-AuroraMutableLayout $root
Assert-AuroraLocalConfigSafe $root
if (Test-Path -LiteralPath (Join-Path $root 'config\app.local.json') -PathType Leaf) { Write-AuroraWarning 'Lokal konfiguration ignoreras under build; verifierade standardvärden används. / Local configuration is ignored during build; verified defaults are used.' }
$platform = Get-AuroraPlatform
$nodeArchive = Join-Path $root "runtime\payload\node-$platform.zip"
$llamaArchive = Join-Path $root "llm\payload\llama-$platform.zip"
if (-not (Test-Path -LiteralPath $nodeArchive -PathType Leaf)) { Stop-Aurora 'Portabel Node-runtime saknas. Kör prepare_release online. / Portable Node runtime is missing. Run prepare_release online.' }
if (-not (Test-Path -LiteralPath $llamaArchive -PathType Leaf)) { Stop-Aurora 'llama-server saknas. Kör prepare_release online. / llama-server is missing. Run prepare_release online.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'offline\npm-cache\_cacache') -PathType Container)) { Stop-Aurora 'Offline npm-lager saknas. / Offline npm store is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'web\dist\index.html') -PathType Leaf)) { Stop-Aurora 'Byggd webbklient saknas. / Built web client is missing.' }

$runtime = Join-Path $root '.runtime'
$unexpectedRuntime = Get-ChildItem -LiteralPath $root -Force -ErrorAction Stop |
    Where-Object { $_.Name -like '.runtime.build.*' -or $_.Name -like '.runtime.previous.*' }
if ($unexpectedRuntime.Count -gt 0) { Stop-Aurora "Oväntat runtime-stagingobjekt finns: $($unexpectedRuntime[0].Name). Flytta det åt sidan och kör build igen. / Unexpected runtime staging state exists. Move it aside and run build again." }
if (Test-Path -LiteralPath $runtime) {
    $runtimeItem = Get-Item -LiteralPath $runtime -Force
    if (($runtimeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Aurora '.runtime får inte vara en länk/junction. Ta bort den manuellt efter granskning. / .runtime must not be a link or junction. Remove it manually after review.' }
}

# Never execute an installed runtime: it is mutable and absent from the release
# manifest. Stop owned processes, remove it, and extract a fresh candidate only
# from the archives whose checksums were verified above.
& (Join-Path $root 'scripts\stop.ps1')
if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
$runtimeCandidate = Join-Path $root ('.runtime.build.' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runtimeCandidate | Out-Null
$previousDefaultsOnly = $env:AURORA_CONFIG_DEFAULTS_ONLY
$env:AURORA_CONFIG_DEFAULTS_ONLY = '1'

try {
    $nodeExtract = Join-Path $runtimeCandidate 'node-extract'
    New-Item -ItemType Directory -Path $nodeExtract | Out-Null
    Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeExtract -Force
    $foundNode = Get-ChildItem -LiteralPath $nodeExtract -Recurse -Filter node.exe -File | Select-Object -First 1
    if ($null -eq $foundNode) { Stop-Aurora 'Node-arkivet har oväntat innehåll. / Node archive has unexpected contents.' }
    $nodeDir = Join-Path $runtimeCandidate 'node'
    New-Item -ItemType Directory -Path $nodeDir | Out-Null
    Get-ChildItem -LiteralPath $foundNode.Directory.FullName -Force | Move-Item -Destination $nodeDir
    Remove-Item -LiteralPath $nodeExtract -Recurse -Force
    $node = Join-Path $nodeDir 'node.exe'

    $llamaDir = Join-Path $runtimeCandidate 'llama'
    Expand-Archive -LiteralPath $llamaArchive -DestinationPath $llamaDir -Force
    $llama = Get-AuroraLlama $root $runtimeCandidate
    if ($null -eq $llama) { Stop-Aurora 'llama-server hittades inte i det verifierade arkivet. / llama-server was not found in the verified archive.' }

    $npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { Stop-Aurora 'npm saknas i den portabla Node-runtimen. / npm is missing from portable Node.' }
    Write-AuroraInfo 'Installerar produktionsberoenden från offline-lagret ... / Installing production dependencies from the offline store ...'
    Push-Location $root
    try {
        $env:npm_config_update_notifier = 'false'
        $env:npm_config_audit = 'false'
        $env:npm_config_cache = Join-Path $root 'offline\npm-cache'
        & $node $npmCli ci --offline --cache (Join-Path $root 'offline\npm-cache') --omit=dev --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Offline npm-installation misslyckades. / Offline npm installation failed.' }
    } finally { Pop-Location }

    $data = Join-Path $root 'data'
    Initialize-AuroraMutableLayout $root
    Write-AuroraInfo 'Initierar databas och BAS-begreppslista ... / Initializing database and BAS vocabulary ...'
    & $node (Join-Path $root 'server\index.mjs') --root $root --data-dir $data --migrate-only
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Databasinitiering misslyckades. / Database initialization failed.' }

    if ($restoreLatest) {
        $latest = Get-ChildItem -LiteralPath (Join-Path $root 'exports') -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like 'aurora-final-*.xlsx' -or $_.Name -like 'aurora-final-*.csv' } |
            Sort-Object Name -Descending | Select-Object -First 1
        if ($null -eq $latest) { Stop-Aurora 'Ingen tidigare export hittades. / No previous export was found.' }
        Write-AuroraInfo "Återställer $($latest.Name) ... / Restoring $($latest.Name) ..."
        & $node (Join-Path $root 'server\index.mjs') --root $root --data-dir $data --import $latest.FullName
        if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Återställning misslyckades. / Restore failed.' }
    }

    & $node (Join-Path $root 'scripts\local-self-test.mjs')
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Lokalt koordinattest misslyckades. / Local coordinate test failed.' }
    $requestedLlmPort = Get-AuroraConfig $root 'llmPort' $node
    $llmPort = (& $node (Join-Path $root 'scripts\port-utils.mjs') $requestedLlmPort).Trim()
    $modelRelative = Get-AuroraConfig $root 'modelPath' $node
    $model = (& $node (Join-Path $root 'scripts\config-cli.mjs') model).Trim()
    if (-not (Test-Path -LiteralPath $model -PathType Leaf)) { Stop-Aurora "GGUF-modellen saknas: $modelRelative. Kör prepare_release online innan USB-kopiering. / GGUF model is missing. Run prepare_release online before USB transfer." }
    $modelsRoot = [IO.Path]::GetFullPath((Join-Path $root 'llm\models'))
    $modelFull = [IO.Path]::GetFullPath($model)
    if (-not $modelFull.StartsWith("$modelsRoot\", [StringComparison]::OrdinalIgnoreCase)) { Stop-Aurora 'Standardmodellen ligger utanför llm\models. / Default model is outside llm/models.' }
    $modelManifestRelative = $modelFull.Substring($root.Length + 1).Replace('\','/')
    if (-not (Test-AuroraManifestPath $root $modelManifestRelative)) { Stop-Aurora "Standardmodellen är inte manifestverifierad: $modelManifestRelative / Default model is not manifest-verified." }
    if (-not (Test-AuroraLockedModelPath $root $modelManifestRelative)) { Stop-Aurora "Standardmodellen är inte en pinnad kind=model-artefakt: $modelManifestRelative / Default model is not a pinned kind=model artifact." }
    $outLog = Join-Path $data 'logs\build-self-test.out.log'
    $errLog = Join-Path $data 'logs\build-self-test.err.log'
    Reset-AuroraLogFile $outLog
    Reset-AuroraLogFile $errLog
    $llamaArgs = @('--host','127.0.0.1','--port',$llmPort,'--model',('"{0}"' -f $model),'--ctx-size',(Get-AuroraConfig $root 'llm.contextSize' $node),'--seed',(Get-AuroraConfig $root 'llm.seed' $node),'--n-gpu-layers','0')
    $apiKey = (& $node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))').Trim()
    if ($LASTEXITCODE -ne 0 -or $apiKey -notmatch '^[0-9a-f]{64}$') { Stop-Aurora 'Kunde inte skapa lokal LLM-nyckel. / Could not generate the local LLM key.' }
    Write-AuroraInfo 'Startar lokalt LLM-självtest ... / Starting local LLM self-test ...'
    $previousLlamaKey = $env:LLAMA_API_KEY
    $env:LLAMA_API_KEY = $apiKey
    try {
        $llamaProcess = Start-Process -FilePath $llama -ArgumentList $llamaArgs -WorkingDirectory (Split-Path $llama) -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
    } finally { if ($null -eq $previousLlamaKey) { Remove-Item Env:\LLAMA_API_KEY -ErrorAction SilentlyContinue } else { $env:LLAMA_API_KEY = $previousLlamaKey } }
    $previousAuroraKey = $env:AURORA_LLM_API_KEY
    $env:AURORA_LLM_API_KEY = $apiKey
    try {
        try {
            & $node (Join-Path $root 'scripts\wait-for-http.mjs') "http://127.0.0.1:$llmPort/health" 240000
            if ($LASTEXITCODE -ne 0) { Stop-Aurora 'llama-server startade inte. Se data\logs\build-self-test.*.log. / llama-server did not start. See the build-self-test logs.' }
            & $node (Join-Path $root 'scripts\llm-self-test.mjs') $llmPort
            if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Det grammatikstyrda LLM-testet misslyckades. / Grammar-constrained LLM test failed.' }
            & $node (Join-Path $root 'server\index.mjs') --root $root --data-dir $data --llm-port $llmPort --self-test
            if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Serversjälvtestet misslyckades. / Server self-test failed.' }
        } finally {
            if (-not $llamaProcess.HasExited) { Stop-Process -Id $llamaProcess.Id -Force -ErrorAction SilentlyContinue }
        }
    } finally { if ($null -eq $previousAuroraKey) { Remove-Item Env:\AURORA_LLM_API_KEY -ErrorAction SilentlyContinue } else { $env:AURORA_LLM_API_KEY = $previousAuroraKey } }

    $marker = [ordered]@{ platform=$platform; nodeArchiveSha256=(Get-AuroraSha256 $nodeArchive); llamaArchiveSha256=(Get-AuroraSha256 $llamaArchive); builtAt=(Get-Date).ToUniversalTime().ToString('o') }
    $marker | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $runtimeCandidate 'install.json') -Encoding UTF8
    [IO.Directory]::Move($runtimeCandidate, $runtime)
} finally {
    if ($null -eq $previousDefaultsOnly) { Remove-Item Env:\AURORA_CONFIG_DEFAULTS_ONLY -ErrorAction SilentlyContinue } else { $env:AURORA_CONFIG_DEFAULTS_ONLY = $previousDefaultsOnly }
    if (Test-Path -LiteralPath $runtimeCandidate) { Remove-Item -LiteralPath $runtimeCandidate -Recurse -Force }
}
Write-AuroraInfo 'OK — Aurora Intel är byggt offline. Kör start.bat. / Aurora Intel is built offline. Run start.bat.'
