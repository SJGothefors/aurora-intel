$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$root = Get-AuroraRoot
Assert-AuroraRoot $root
$signingKey = $null
for ($index = 0; $index -lt $args.Count; $index++) {
    switch ($args[$index]) {
        '--signing-key' { if (++$index -ge $args.Count) { Stop-Aurora '--signing-key kräver en sökväg. / --signing-key requires a path.' }; $signingKey = $args[$index] }
        '-h' { Write-Host 'Usage: scripts\prepare_release.ps1 [--signing-key ED25519_PRIVATE_KEY.pem]'; exit 0 }
        '--help' { Write-Host 'Usage: scripts\prepare_release.ps1 [--signing-key ED25519_PRIVATE_KEY.pem]'; exit 0 }
        default { Stop-Aurora "Okänt argument: $($args[$index]) / Unknown argument" }
    }
}
if ($null -ne $signingKey -and -not (Test-Path -LiteralPath $signingKey -PathType Leaf)) { Stop-Aurora 'Signeringsnyckeln kan inte läsas. / Signing key is not readable.' }
$platform = Get-AuroraPlatform
if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json') -PathType Leaf)) { Stop-Aurora 'package.json saknas. / package.json is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'package-lock.json') -PathType Leaf)) { Stop-Aurora 'package-lock.json saknas; skapa och granska låsfilen först. / package-lock.json is missing; create and review it first.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'assets\model\Mistral-7B-Instruct-v0.3-LICENSE.txt') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $root 'assets\model\README.md') -PathType Leaf)) { Stop-Aurora 'Modellens licens/proveniens saknas. / Model license or provenance is missing.' }
$defaults = Get-Content -LiteralPath (Join-Path $root 'config\app.defaults.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $defaults.appVersion
if ([string]::IsNullOrWhiteSpace($version)) { Stop-Aurora 'appVersion saknas. / appVersion is missing.' }
$releaseRoot = Join-Path $root 'applicationExportFolder'
$artifactCache = Join-Path $root '.cache\release-artifacts'
New-Item -ItemType Directory -Path $releaseRoot,$artifactCache -Force | Out-Null
$work = Join-Path $releaseRoot ('.prepare.' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $work "aurora-intel-v$version-offline"
New-Item -ItemType Directory -Path $stage -Force | Out-Null

try {
    Write-AuroraInfo 'Kopierar releasekällor ... / Copying release sources ...'
    $items = @('scripts','server','web','assets','config','knowledge','docs','tests','vendor','package.json','package-lock.json','README.md','LICENSE','NOTICE','build.command','build.sh','build.bat','start.command','start.sh','start.bat','stop.command','stop.sh','stop.bat','teardown.command','teardown.sh','teardown.bat')
    foreach ($item in $items) {
        $source = Join-Path $root $item
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $stage -Recurse -Force }
    }
    # Runtime-local settings must never leak into a distributable release.
    Remove-Item -LiteralPath (Join-Path $stage 'config\app.local.json') -Force -ErrorAction SilentlyContinue
    foreach ($directory in @('runtime\payload','llm\payload','llm\models','offline\npm-cache','exports')) { New-Item -ItemType Directory -Path (Join-Path $stage $directory) -Force | Out-Null }

    Write-AuroraInfo 'Hämtar och verifierar pinnade artefakter ... / Downloading and verifying pinned artifacts ...'
    foreach ($line in Get-Content -LiteralPath (Join-Path $root 'config\versions.lock') -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
        $fields = $line.Split('|')
        if ($fields.Count -ne 7) { Stop-Aurora "Ogiltig versions.lock-rad: $line / Invalid versions.lock entry." }
        $artifactId,$artifactPlatform,$artifactKind,$filename,$url,$sha,$destination = $fields
        if (-not $url.StartsWith('https://')) { Stop-Aurora "Endast HTTPS tillåts: $artifactId / Only HTTPS is allowed." }
        if ($sha -notmatch '^[0-9a-fA-F]{64}$') { Stop-Aurora "Ogiltig SHA-256: $artifactId / Invalid SHA-256." }
        if ([IO.Path]::IsPathRooted($destination) -or $destination -match '(^|[\\/])\.\.([\\/]|$)') { Stop-Aurora "Osäker destination: $destination / Unsafe destination." }
        $cached = Join-Path $artifactCache $filename
        if ((Test-Path -LiteralPath $cached -PathType Leaf) -and (Get-AuroraSha256 $cached) -ne $sha.ToLowerInvariant()) {
            Move-Item -LiteralPath $cached -Destination "$cached.invalid.$(Get-Date -Format 'yyyyMMddHHmmss')"
        }
        if (-not (Test-Path -LiteralPath $cached -PathType Leaf)) {
            Write-AuroraInfo "  $artifactId ($filename)"
            if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
                Start-BitsTransfer -Source $url -Destination $cached -DisplayName "Aurora $artifactId"
            } else {
                Invoke-WebRequest -Uri $url -OutFile $cached -UseBasicParsing
            }
        }
        if ((Get-AuroraSha256 $cached) -ne $sha.ToLowerInvariant()) { Stop-Aurora "SHA-256 stämmer inte: $artifactId / SHA-256 mismatch." }
        if ($artifactKind -in @('node','llama')) {
            $archiveEntries = @(& tar.exe -tf $cached)
            if ($LASTEXITCODE -ne 0 -or $null -eq ($archiveEntries | Where-Object { (Split-Path $_ -Leaf) -match '^LICENSE(?:\..*)?$' } | Select-Object -First 1)) { Stop-Aurora "Licensfil saknas i arkivet för $artifactId. / Embedded license file is missing from the $artifactId archive." }
        }
        $target = Join-Path $stage $destination
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item -LiteralPath $cached -Destination $target -Force
    }

    $nodeArchive = Join-Path $stage "runtime\payload\node-$platform.zip"
    if (-not (Test-Path -LiteralPath $nodeArchive -PathType Leaf)) { Stop-Aurora 'Node-runtime för byggdatorn saknas. / Node runtime for the build host is missing.' }
    $toolchainArchive = Join-Path $work 'toolchain-archive'
    $toolchain = Join-Path $work 'toolchain'
    Expand-Archive -LiteralPath $nodeArchive -DestinationPath $toolchainArchive -Force
    $toolNodeFound = Get-ChildItem -LiteralPath $toolchainArchive -Recurse -Filter node.exe -File | Select-Object -First 1
    if ($null -eq $toolNodeFound) { Stop-Aurora 'Portabel Node kunde inte packas upp. / Portable Node could not be unpacked.' }
    New-Item -ItemType Directory -Path $toolchain | Out-Null
    Get-ChildItem -LiteralPath $toolNodeFound.Directory.FullName -Force | Move-Item -Destination $toolchain
    $toolNode = Join-Path $toolchain 'node.exe'
    $npmCli = Join-Path $toolchain 'node_modules\npm\bin\npm-cli.js'

    Write-AuroraInfo 'Fyller npm-lagret för installation utan nät ... / Populating npm store for network-free installation ...'
    & $toolNode (Join-Path $stage 'scripts\cache-packages.mjs') (Join-Path $stage 'package-lock.json') (Join-Path $stage 'offline\npm-cache') $npmCli
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Npm-lagret kunde inte skapas. / Could not create npm store.' }
    Push-Location $stage
    try {
        $env:npm_config_update_notifier = 'false'
        $env:npm_config_audit = 'false'
        $env:npm_config_cache = Join-Path $stage 'offline\npm-cache'
        & $toolNode $npmCli ci --offline --cache (Join-Path $stage 'offline\npm-cache') --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Verifierad offline npm-installation misslyckades. / Verified offline npm installation failed.' }
        & $toolNode -e 'const p=require("./package.json");process.exit(p.scripts?.check?0:1)'
        if ($LASTEXITCODE -eq 0) {
            & $toolNode $npmCli run check
            if ($LASTEXITCODE -ne 0) { Stop-Aurora 'npm run check misslyckades. / npm run check failed.' }
        } else {
            & $toolNode $npmCli run build
            if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Frontendbygget misslyckades. / Frontend build failed.' }
            & $toolNode (Join-Path $stage 'scripts\offline-guard.mjs') (Join-Path $stage 'web\dist')
            & $toolNode $npmCli run test:licenses --if-present
        }
    } finally { Pop-Location }
    if (-not (Test-Path -LiteralPath (Join-Path $stage 'web\dist\index.html') -PathType Leaf)) { Stop-Aurora 'Frontendbygget saknar index.html. / Frontend build is missing index.html.' }
    & $toolNode (Join-Path $stage 'scripts\offline-guard.mjs') (Join-Path $stage 'web\dist')
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Offlinekontrollen misslyckades. / Offline guard failed.' }
    Remove-Item -LiteralPath (Join-Path $stage 'node_modules') -Recurse -Force

    Write-AuroraInfo 'Skapar maskinläsbar komponentförteckning ... / Creating machine-readable component inventory ...'
    & $toolNode (Join-Path $stage 'scripts\make-sbom.mjs') $stage
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $stage 'docs\release\aurora-intel.cdx.json') -PathType Leaf)) { Stop-Aurora 'CycloneDX-SBOM kunde inte skapas. / CycloneDX SBOM could not be created.' }

    @'
AURORA INTEL — OFFLINE RELEASE

SV: Detta är ett komplett USB-paket förutsatt att build godkänner alla
kontrollsummor och självtester. Packa upp hela mappen, kör build.bat och
därefter start.bat.

EN: This is a complete USB package provided build passes every checksum and
self-test. Extract the whole folder, run build.bat, then start.bat.
'@ | Set-Content -LiteralPath (Join-Path $stage 'RELEASE_READY.txt') -Encoding UTF8
    & $toolNode (Join-Path $stage 'scripts\make-checksums.mjs') $stage
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Kontrollsummor kunde inte skapas. / Could not create checksums.' }

    $final = Join-Path $releaseRoot "aurora-intel-v$version-offline"
    if (Test-Path -LiteralPath $final) { Move-Item -LiteralPath $final -Destination "$final.previous.$(Get-Date -Format 'yyyyMMddHHmmss')" }
    Move-Item -LiteralPath $stage -Destination $final
    $archive = Join-Path $releaseRoot "aurora-intel-v$version-offline.zip"
    if (Test-Path -LiteralPath $archive) { Move-Item -LiteralPath $archive -Destination "$archive.previous.$(Get-Date -Format 'yyyyMMddHHmmss')" }
    Push-Location $releaseRoot
    try {
        & tar.exe -a -c -f $archive (Split-Path $final -Leaf)
        if ($LASTEXITCODE -ne 0) { Stop-Aurora 'ZIP-arkivet kunde inte skapas. Releasemappen är komplett. / ZIP could not be created; release folder is complete.' }
    } finally { Pop-Location }
    & $toolNode (Join-Path $final 'scripts\fix-zip-permissions.mjs') $archive
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'ZIP-rättigheter kunde inte normaliseras. / ZIP permissions could not be normalized.' }
    $archiveSha = Get-AuroraSha256 $archive
    ('{0}  {1}' -f $archiveSha, (Split-Path $archive -Leaf)) | Set-Content -LiteralPath (Join-Path $releaseRoot 'checksums.txt') -Encoding ASCII
    if ($null -ne $signingKey) {
        & $toolNode (Join-Path $final 'scripts\release-signature.mjs') sign $archive $archiveSha $signingKey "$archive.sig.json" "$archive.pub.pem"
        if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Fristående releasesignering misslyckades. / Detached release signing failed.' }
    }
    & $toolNode (Join-Path $final 'scripts\verify-release-output.mjs') $releaseRoot $version
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'Releaseutdata kunde inte verifieras. / Release output verification failed.' }
    Write-AuroraInfo "OK — Offlinepaket: $final"
    Write-AuroraInfo "ZIP: $archive"
    Write-AuroraInfo 'Kopiera ZIP-filen (eller hela releasemappen) till USB. / Copy the ZIP (or full release folder) to USB.'
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
