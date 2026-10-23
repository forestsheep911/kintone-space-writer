param([string]$Tool = 'doctor')
# Compatible with Windows PowerShell 5.1. No Python or globally installed uv required.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$ToolArguments = @($args)
$PrepareLock = $null
$ArchiveTemp = $null
$ExeTemp = $null
function Get-Sha256([string]$Path) {
    $Stream = [IO.File]::OpenRead($Path)
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($Hasher.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
    finally { $Stream.Dispose(); $Hasher.Dispose() }
}
try {
    if ($Tool -notin @('doctor', 'bridge', 'rest')) { throw 'Expected doctor, bridge, or rest.' }
    $PluginRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $Manifest = Get-Content -LiteralPath (Join-Path $PluginRoot 'runtime/uv-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $Architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $Target = switch ($Architecture.ToUpperInvariant()) {
        'AMD64' { 'windows-x86_64' }
        'ARM64' { 'windows-aarch64' }
        default { throw "Unsupported Windows architecture: $Architecture" }
    }
    $Asset = $Manifest.platforms.$Target
    if (-not $Asset) { throw "No pinned uv build for $Target" }
    $RuntimeRoot = if ($env:KSW_RUNTIME_HOME) { [IO.Path]::GetFullPath($env:KSW_RUNTIME_HOME) } else { Join-Path $env:LOCALAPPDATA 'kintone-space-writer' }
    [IO.Directory]::CreateDirectory($RuntimeRoot) | Out-Null
    # Lifetime file handle, not a stale lock-file marker; process exit releases it.
    $LockPath = Join-Path $RuntimeRoot 'prepare.lock'
    $Deadline = [DateTime]::UtcNow.AddMinutes(5)
    while (-not $PrepareLock) {
        try { $PrepareLock = [IO.File]::Open($LockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
        catch [IO.IOException] {
            if ([DateTime]::UtcNow -ge $Deadline) { throw 'Timed out waiting for runtime preparation.' }
            Start-Sleep -Milliseconds 200
        }
    }
    $BundledUv = Join-Path $PluginRoot "runtime/bin/$Target/uv.exe"
    $UvDirectory = Join-Path $RuntimeRoot "uv/$($Manifest.uvVersion)/$Target"
    [IO.Directory]::CreateDirectory($UvDirectory) | Out-Null
    $Uv = Join-Path $UvDirectory 'uv.exe'
    if (Test-Path -LiteralPath $BundledUv) {
        if ((Get-Sha256 $BundledUv) -ne $Asset.executableSha256) { throw 'Bundled uv checksum mismatch.' }
        $Uv = $BundledUv
    } elseif (-not (Test-Path -LiteralPath $Uv) -or (Get-Sha256 $Uv) -ne $Asset.executableSha256) {
        $ArchiveTemp = Join-Path $UvDirectory ([Guid]::NewGuid().ToString('N') + '.zip')
        $ExeTemp = Join-Path $UvDirectory ([Guid]::NewGuid().ToString('N') + '.exe')
        [Console]::Error.WriteLine('Preparing Space Writer runtime: downloading pinned uv...')
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $Asset.url -OutFile $ArchiveTemp -UseBasicParsing -TimeoutSec 180
        if ((Get-Sha256 $ArchiveTemp) -ne $Asset.archiveSha256) { throw 'Downloaded uv archive checksum mismatch.' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $Archive = [IO.Compression.ZipFile]::OpenRead($ArchiveTemp)
        try {
            $Entry = $Archive.GetEntry($Asset.member)
            if (-not $Entry) { throw 'Pinned uv executable is missing from archive.' }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($Entry, $ExeTemp)
        } finally { $Archive.Dispose() }
        if ((Get-Sha256 $ExeTemp) -ne $Asset.executableSha256) { throw 'Extracted uv checksum mismatch.' }
        [IO.File]::Copy($ExeTemp, $Uv, $true)
    }
    $Plugin = Get-Content -LiteralPath (Join-Path $PluginRoot '.codex-plugin/plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $LockHash = (Get-Sha256 (Join-Path $PluginRoot 'uv.lock')).Substring(0, 12)
    $Environment = Join-Path $RuntimeRoot "environments/$($Plugin.version)-$LockHash-$Target"
    $env:KSW_RUNTIME_HOME = $RuntimeRoot
    $env:UV_PROJECT_ENVIRONMENT = $Environment
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $RuntimeRoot 'python'
    $env:UV_CACHE_DIR = Join-Path $RuntimeRoot 'cache'
    $env:UV_PYTHON_INSTALL_BIN = '0'
    $env:UV_PYTHON_NO_REGISTRY = '1'
    $env:UV_PYTHON_PREFERENCE = if ($env:KSW_PYTHON_SOURCE -eq 'managed') { 'only-managed' } else { 'system' }
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:PYTHONNOUSERSITE = '1'
    foreach ($InheritedPythonSetting in @('PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV')) {
        [Environment]::SetEnvironmentVariable($InheritedPythonSetting, $null, 'Process')
    }
    & $Uv --no-config --no-progress --color never sync --project $PluginRoot --locked --no-dev --python $Manifest.pythonVersion
    if ($LASTEXITCODE -ne 0) { throw 'Runtime preparation failed. Check network access to the pinned Python download and PyPI; retry the same command.' }
    $PrepareLock.Dispose()
    $PrepareLock = $null
    $Python = Join-Path $Environment 'Scripts/python.exe'
    & $Python (Join-Path $PSScriptRoot 'runtime_entry.py') $Tool @ToolArguments
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine("Space Writer runtime: $($_.Exception.Message)")
    exit 1
} finally {
    if ($PrepareLock) { $PrepareLock.Dispose() }
    foreach ($TemporaryFile in @($ArchiveTemp, $ExeTemp)) {
        if ($TemporaryFile -and (Test-Path -LiteralPath $TemporaryFile)) { Remove-Item -LiteralPath $TemporaryFile -Force }
    }
}
