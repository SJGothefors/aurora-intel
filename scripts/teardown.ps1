$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$root = Get-AuroraRoot
Assert-AuroraRoot $root
$noExport = $false
$purgeExports = $false
foreach ($argValue in $args) {
    switch ($argValue) {
        '--no-export' { $noExport = $true }
        '--purge-exports' { $purgeExports = $true }
        '-h' { Write-Host 'Usage: scripts\teardown.ps1 [--no-export] [--purge-exports]'; exit 0 }
        '--help' { Write-Host 'Usage: scripts\teardown.ps1 [--no-export] [--purge-exports]'; exit 0 }
        default { Stop-Aurora "Okänt argument: $argValue / Unknown argument" }
    }
}

if ($purgeExports) {
    Write-Host 'TOTAL RADERING / TOTAL WIPE'
    Write-Host 'Detta tar även bort alla exporter. Skriv exakt: RADERA AURORA'
    Write-Host 'This also removes all exports. Type exactly: RADERA AURORA'
    $confirmation = Read-Host
    if ($confirmation -cne 'RADERA AURORA') { Stop-Aurora 'Bekräftelsen stämde inte; inget har raderats. / Confirmation did not match; nothing was deleted.' }
}

& (Join-Path $root 'scripts\stop.ps1')
$data = Join-Path $root 'data'
$database = Join-Path $data 'aurora.db'
if (-not $noExport -and (Test-Path -LiteralPath $database -PathType Leaf)) {
    $node = Get-AuroraNode $root
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { Stop-Aurora 'Kan inte skapa slutexport; Node saknas. Data har inte raderats. / Cannot create final export; Node is missing. Data was not deleted.' }
    $exports = Join-Path $root 'exports'
    New-Item -ItemType Directory -Path $exports -Force | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmm'
    $xlsx = Join-Path $exports "aurora-final-$timestamp.xlsx"
    $csv = Join-Path $exports "aurora-final-$timestamp.csv"
    Write-AuroraInfo 'Skapar slutexport ... / Creating final export ...'
    & $node (Join-Path $root 'server\index.mjs') --root $root --data-dir $data --export $xlsx
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'XLSX-exporten misslyckades; data har inte raderats. / XLSX export failed; data was not deleted.' }
    & $node (Join-Path $root 'server\index.mjs') --root $root --data-dir $data --export $csv
    if ($LASTEXITCODE -ne 0) { Stop-Aurora 'CSV-exporten misslyckades; data har inte raderats. / CSV export failed; data was not deleted.' }
    if ((Get-Item -LiteralPath $xlsx).Length -eq 0 -or (Get-Item -LiteralPath $csv).Length -eq 0) { Stop-Aurora 'Slutexporten blev tom; data har inte raderats. / Final export was empty; data was not deleted.' }
    Write-AuroraInfo "Sparat: exports\$(Split-Path $xlsx -Leaf) och $(Split-Path $csv -Leaf) / Saved final exports."
} elseif (-not $noExport) { Write-AuroraInfo 'Ingen databas finns; slutexport hoppas över. / No database exists; final export skipped.' }
else { Write-AuroraWarning 'Slutexport hoppades över med --no-export. / Final export skipped with --no-export.' }

foreach ($target in @('data','.runtime','node_modules','.cache')) {
    $path = Join-Path $root $target
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
Remove-Item -LiteralPath (Join-Path $root 'config\app.local.json') -Force -ErrorAction SilentlyContinue
if ($purgeExports) {
    Remove-Item -LiteralPath (Join-Path $root 'exports') -Recurse -Force -ErrorAction SilentlyContinue
    Write-AuroraWarning 'Alla data och exporter har raderats permanent. / All data and exports were permanently deleted.'
} else {
    Write-AuroraInfo 'Lokalt tillstånd är borttaget; källkod, releasepayload och exporter finns kvar. / Local state removed; source, release payload, and exports remain.'
    Write-AuroraInfo 'Kör build.bat --restore-latest för att återställa. / Run build.bat --restore-latest to restore.'
}
