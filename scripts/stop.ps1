$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$root = Get-AuroraRoot
Assert-AuroraRoot $root
if ($args.Count -eq 1 -and $args[0] -in @('-h', '--help')) { Write-Host 'Usage: scripts\stop.ps1'; exit 0 }
if ($args.Count -gt 0) { Stop-Aurora 'stop tar inga argument. / stop takes no arguments.' }
Assert-AuroraMutableLayout $root
$logs = Join-Path $root 'data\logs'
$stopped = $false
foreach ($name in @('supervisor','app','llama')) {
    $file = Join-Path $logs "$name.pid"
    $pidValue = Get-AuroraPidFile $file
    if ($null -eq $pidValue -or -not (Test-AuroraPid $pidValue)) { continue }
    if (Test-AuroraOwnedProcess $pidValue $root) {
        Stop-Process -Id $pidValue -ErrorAction SilentlyContinue
        $stopped = $true
    } else { Write-AuroraWarning "Ignorerar inaktuell PID $pidValue ($name). / Ignoring stale PID." }
}
$supervisorPid = Get-AuroraPidFile (Join-Path $logs 'supervisor.pid')
if ($null -ne $supervisorPid) {
    for ($attempt = 0; $attempt -lt 50 -and (Test-AuroraPid $supervisorPid); $attempt++) { Start-Sleep -Milliseconds 200 }
}
foreach ($name in @('supervisor.pid','app.pid','llama.pid')) { Remove-Item -LiteralPath (Join-Path $logs $name) -Force -ErrorAction SilentlyContinue }
if ($stopped) { Write-AuroraInfo 'Aurora har stoppats. Data är orörda. / Aurora has stopped. Data is untouched.' }
else { Write-AuroraInfo 'Aurora kördes inte. / Aurora was not running.' }
