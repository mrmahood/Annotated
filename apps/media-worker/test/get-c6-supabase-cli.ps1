[CmdletBinding()]
param(
  [string] $Destination = (Join-Path $env:TEMP 'Annotated-supabase-2.115.0')
)

$ErrorActionPreference = 'Stop'
$version = '2.115.0'
$checksumsUrl = "https://github.com/supabase/cli/releases/download/v$version/checksums.txt"
$archiveName = "supabase_${version}_windows_amd64.zip"
$archiveUrl = "https://github.com/supabase/cli/releases/download/v$version/$archiveName"
$publishedChecksumsSha256 = 'a20bc5c8d5d0b03dff637aa98f1758d117811aeed30eb0485ac9ff22b2ada5be'
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
if (-not $destinationPath.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The Supabase CLI destination must be inside the Windows temporary directory.'
}
if (Test-Path -LiteralPath $destinationPath) {
  throw "The temporary Supabase CLI destination already exists: $destinationPath"
}

$checksumsPath = Join-Path $destinationPath 'checksums.txt'
$archivePath = Join-Path $destinationPath $archiveName
$extractedPath = Join-Path $destinationPath 'extracted'
New-Item -ItemType Directory -Path $destinationPath | Out-Null

Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath -UseBasicParsing
$actualChecksumsSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $checksumsPath).Hash.ToLowerInvariant()
if ($actualChecksumsSha256 -ne $publishedChecksumsSha256) {
  throw 'The Supabase checksums file SHA-256 does not match the official GitHub release asset.'
}

$checksumLine = Select-String -LiteralPath $checksumsPath -Pattern ("^[0-9a-fA-F]{64}\s+\*?" + [regex]::Escape($archiveName) + '$')
if (@($checksumLine).Count -ne 1) { throw 'The Windows AMD64 archive has no unique published checksum.' }
$expectedArchiveSha256 = (($checksumLine.Line -split '\s+')[0]).ToLowerInvariant()

Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
$actualArchiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if ($actualArchiveSha256 -ne $expectedArchiveSha256) {
  throw 'The Supabase Windows AMD64 archive SHA-256 does not match the published checksum.'
}

Expand-Archive -LiteralPath $archivePath -DestinationPath $extractedPath
$executable = Join-Path $extractedPath 'supabase.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'The Supabase executable is missing from the verified archive.' }
$reportedVersion = (& $executable --version).Trim()
if ($LASTEXITCODE -ne 0 -or $reportedVersion -ne $version) { throw 'The extracted Supabase executable reported an unexpected version.' }

[ordered]@{
  gate = 'c6_supabase_cli_acquisition'
  version = $reportedVersion
  checksums_sha256 = $actualChecksumsSha256
  archive_sha256 = $actualArchiveSha256
  archive_checksum_verified = $true
  executable_path = $executable
  installed_system_wide = $false
  repository_dependency_added = $false
} | ConvertTo-Json -Compress
