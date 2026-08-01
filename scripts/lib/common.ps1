Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$AuroraCommonRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Get-AuroraRoot {
    return $AuroraCommonRoot
}

function Write-AuroraInfo([string]$Message) { Write-Host $Message }
function Write-AuroraWarning([string]$Message) { Write-Warning "VARNING / WARNING: $Message" }
function Stop-Aurora([string]$Message) { throw "FEL / ERROR: $Message" }

function Assert-AuroraRoot([string]$Root) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root 'config\app.defaults.json') -PathType Leaf)) {
        Stop-Aurora "Ogiltig Aurora-mapp. / Invalid Aurora folder: $Root"
    }
}

function Get-AuroraPlatform {
    if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) { Stop-Aurora 'Använd .sh-skripten på macOS. / Use the .sh scripts on macOS.' }
    if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
        Stop-Aurora 'Endast Windows x64 stöds. / Only Windows x64 is supported.'
    }
    return 'windows-x64'
}

function Get-AuroraSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-AuroraManifestPath([string]$Root, [string]$RelativePath) {
    $manifest = Join-Path $Root 'checksums.txt'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $false }
    foreach ($line in Get-Content -LiteralPath $manifest -Encoding UTF8) {
        if ($line.Length -ge 67 -and $line.Substring(66) -ceq $RelativePath) { return $true }
    }
    return $false
}

function Test-AuroraLockedModelPath([string]$Root, [string]$RelativePath) {
    foreach ($line in Get-Content -LiteralPath (Join-Path $Root 'config\versions.lock') -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
        $fields = $line.Split('|')
        if ($fields.Count -eq 7 -and $fields[2] -ceq 'model' -and $fields[6] -ceq $RelativePath) { return $true }
    }
    return $false
}

function Test-AuroraChecksums([string]$Root) {
    $manifest = Join-Path $Root 'checksums.txt'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        Stop-Aurora 'checksums.txt saknas. Detta är inte ett komplett offlinepaket. Kör scripts\prepare_release.ps1 på en internetansluten dator. / checksums.txt is missing. This is not a complete offline package. Run prepare_release.ps1 online.'
    }
    $manifestItem = Get-Item -LiteralPath $manifest -Force
    if (($manifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Aurora 'checksums.txt får inte vara en länk. / checksums.txt must not be a link.' }
    Write-AuroraInfo 'Verifierar offlinepaketet ... / Verifying offline package ...'
    $manifestPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($line in Get-Content -LiteralPath $manifest -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($line)) { Stop-Aurora 'Tom rad i checksums.txt. / Empty checksums.txt entry.' }
        if ($line -notmatch '^([0-9a-fA-F]{64})  (.+)$') { Stop-Aurora 'Ogiltig rad i checksums.txt. / Invalid checksums.txt entry.' }
        $expected = $Matches[1].ToLowerInvariant()
        $relative = $Matches[2]
        if ([IO.Path]::IsPathRooted($relative) -or $relative -notmatch '^[A-Za-z0-9._/@+\-]+$' -or $relative -match '(^|/)\.\.(/|$)|//|^\./|\\') { Stop-Aurora "Osäker sökväg i checksums.txt: $relative / Unsafe checksum path." }
        if ($relative -in @('checksums.txt','config/app.local.json') -or $relative -match '^(?:\.runtime|\.cache|\.git|data|exports|node_modules|release)/') { Stop-Aurora "Föränderlig sökväg får inte finnas i checksums.txt: $relative / Mutable checksum path is not allowed." }
        if (-not $manifestPaths.Add($relative)) { Stop-Aurora "Duplicerad sökväg i checksums.txt: $relative / Duplicate checksum path." }
        $file = Join-Path $Root ($relative -replace '/', '\')
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Stop-Aurora "Fil saknas: $relative / Missing file: $relative" }
        $item = Get-Item -LiteralPath $file -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Aurora "Länk är inte tillåten i releaseinnehåll: $relative / Link is not allowed in release content." }
        if ((Get-AuroraSha256 $file) -ne $expected) { Stop-Aurora "Kontrollsumman stämmer inte: $relative / Checksum mismatch: $relative" }
    }
    if ($manifestPaths.Count -eq 0) { Stop-Aurora 'checksums.txt är tom. / checksums.txt is empty.' }

    $requiredPaths = @('build.sh','scripts/build.sh','scripts/lib/common.sh','scripts/config-cli.mjs','config/app.defaults.json','config/versions.lock','package.json','package-lock.json','server/index.mjs','web/dist/index.html')
    foreach ($required in $requiredPaths) {
        if (-not $manifestPaths.Contains($required)) { Stop-Aurora "Obligatorisk manifestpost saknas: $required / Required manifest entry is missing." }
    }
    foreach ($lockLine in Get-Content -LiteralPath (Join-Path $Root 'config\versions.lock') -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($lockLine) -or $lockLine.StartsWith('#')) { continue }
        $fields = $lockLine.Split('|')
        if ($fields.Count -ne 7 -or [string]::IsNullOrWhiteSpace($fields[6])) { Stop-Aurora 'Ogiltig config\versions.lock. / Invalid config/versions.lock.' }
        if (-not $manifestPaths.Contains($fields[6])) { Stop-Aurora "Pinnad artefakt saknas i manifestet: $($fields[6]) / Pinned artifact is missing from the manifest." }
    }
    if ($null -eq ($manifestPaths | Where-Object { $_.StartsWith('offline/npm-cache/', [StringComparison]::Ordinal) } | Select-Object -First 1)) { Stop-Aurora 'Offline npm-lagret saknas i manifestet. / Offline npm store is missing from the manifest.' }

    $excludedTop = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($name in @('.runtime','.cache','.git','data','exports','node_modules','release')) { [void]$excludedTop.Add($name) }
    function Test-AuroraManifestDirectory([string]$Directory, [string]$Prefix) {
        foreach ($entry in Get-ChildItem -LiteralPath $Directory -Force) {
            $relative = if ([string]::IsNullOrEmpty($Prefix)) { $entry.Name } else { "$Prefix/$($entry.Name)" }
            if ([string]::IsNullOrEmpty($Prefix) -and $excludedTop.Contains($entry.Name)) { continue }
            if ($relative -in @('checksums.txt','config/app.local.json')) { continue }
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Aurora "Otillåten länk i releaseinnehåll: $relative / Link is not allowed in release content." }
            if ($entry.PSIsContainer) { Test-AuroraManifestDirectory $entry.FullName $relative; continue }
            if (-not $manifestPaths.Contains($relative)) { Stop-Aurora "Oväntad fil utanför manifestet: $relative / Unexpected file outside the manifest." }
        }
    }
    Test-AuroraManifestDirectory $Root ''
}

function Assert-AuroraRealDirectoryIfPresent([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) { return }
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Aurora "Osäker katalogsökväg: $Path / Unsafe directory path." }
}

function Assert-AuroraMutableLayout([string]$Root) {
    foreach ($relative in @('data','data\mirror','data\backups','data\logs','exports','node_modules')) { Assert-AuroraRealDirectoryIfPresent (Join-Path $Root $relative) }
}

function Initialize-AuroraMutableLayout([string]$Root) {
    Assert-AuroraMutableLayout $Root
    foreach ($relative in @('data','data\mirror','data\backups','data\logs','exports')) {
        $directory = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
        Assert-AuroraRealDirectoryIfPresent $directory
    }
}

function Reset-AuroraLogFile([string]$Path) {
    Assert-AuroraRealDirectoryIfPresent (Split-Path $Path -Parent)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -ne $item) {
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Aurora "Osäker loggfil: $Path / Unsafe log file." }
        # Removing a hard-link name cannot alter the other name's contents. A new
        # exclusive file prevents Start-Process from following a preseeded link.
        Remove-Item -LiteralPath $Path -Force
    }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $stream.Dispose()
}

function Assert-AuroraLocalConfigSafe([string]$Root) {
    $path = Join-Path $Root 'config\app.local.json'
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if ($null -ne $item -and ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { Stop-Aurora 'config\app.local.json måste vara en vanlig fil, inte en länk. / config/app.local.json must be a regular file, not a link.' }
}

function Get-AuroraNode([string]$Root) { return (Join-Path $Root '.runtime\node\node.exe') }

function Get-AuroraConfig([string]$Root, [string]$Key, [string]$NodePath) {
    $node = if ([string]::IsNullOrWhiteSpace($NodePath)) { Get-AuroraNode $Root } else { $NodePath }
    $value = & $node (Join-Path $Root 'scripts\config-cli.mjs') get $Key
    if ($LASTEXITCODE -ne 0) { Stop-Aurora "Konfigurationen kunde inte läsas. / Could not read configuration: $Key" }
    return "$value".Trim()
}

function Get-AuroraLlama([string]$Root, [string]$RuntimeRoot) {
    $searchRoot = if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) { Join-Path $Root '.runtime' } else { $RuntimeRoot }
    $candidate = Get-ChildItem -LiteralPath (Join-Path $searchRoot 'llama') -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('llama-server.exe', 'server.exe') } |
        Select-Object -First 1
    if ($null -eq $candidate) { return $null }
    return $candidate.FullName
}

function Test-AuroraPid([int]$PidValue) {
    return $null -ne (Get-Process -Id $PidValue -ErrorAction SilentlyContinue)
}

function Test-AuroraOwnedProcess([int]$PidValue, [string]$Root, [string]$RequiredFragment) {
    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $PidValue" -ErrorAction Stop
        if ($null -eq $process -or $process.CommandLine -notlike "*$Root*") { return $false }
        return [string]::IsNullOrWhiteSpace($RequiredFragment) -or $process.CommandLine -like "*$RequiredFragment*"
    } catch { return $false }
}

function Get-AuroraSafeLoopbackUrl([string]$Value) {
    if ($Value -notmatch '^http://127\.0\.0\.1:([0-9]{1,5})$') { return $null }
    $portValue = 0
    if (-not [int]::TryParse($Matches[1], [ref]$portValue) -or $portValue -lt 1 -or $portValue -gt 65535) { return $null }
    $canonical = "http://127.0.0.1:$portValue"
    if ($canonical -cne $Value) { return $null }
    return $canonical
}

function Get-AuroraPidFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $raw = (Get-Content -LiteralPath $Path -Raw -Encoding UTF8).Trim()
    $value = 0
    if (-not [int]::TryParse($raw, [ref]$value) -or $value -le 0) { return $null }
    return $value
}
