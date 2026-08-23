[CmdletBinding()]
param(
  [string] $Supabase = (Join-Path $env:TEMP 'Annotated-supabase-2.115.0\extracted\supabase.exe'),
  [string] $SupabaseHome = (Join-Path $env:TEMP 'Annotated-supabase-c6-home'),
  [switch] $RunDurationGate,
  [switch] $RunDurationDiagnostic,
  [switch] $RunDurationRecovery,
  [switch] $ObserveDurationRecovery,
  [switch] $FinalizeDurationGate,
  [switch] $RunCodecGate,
  [switch] $RunGeometryGate,
  [switch] $RunGeometryDiagnostic,
  [switch] $RunGeometryRecovery
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$previousSupabaseHome = $env:SUPABASE_HOME
if (([int]$RunDurationGate.IsPresent + [int]$RunDurationDiagnostic.IsPresent + [int]$RunDurationRecovery.IsPresent +
    [int]$ObserveDurationRecovery.IsPresent + [int]$FinalizeDurationGate.IsPresent + [int]$RunCodecGate.IsPresent +
    [int]$RunGeometryGate.IsPresent + [int]$RunGeometryDiagnostic.IsPresent + [int]$RunGeometryRecovery.IsPresent) -gt 1) {
  throw 'Select only one C6 acceptance action.'
}

function Get-ProjectReference {
  param([Parameter(Mandatory)] [object] $Project)
  $refProperty = $Project.PSObject.Properties['ref']
  if ($null -ne $refProperty -and -not [string]::IsNullOrWhiteSpace([string]$Project.ref)) {
    return [string]$Project.ref
  }
  return [string]$Project.id
}

if (-not (Test-Path -LiteralPath $Supabase -PathType Leaf)) {
  throw 'The checksum-verified temporary Supabase CLI is missing. Run get-c6-supabase-cli.ps1 first.'
}
$supabaseVersion = (& $Supabase --version).Trim()
if ($LASTEXITCODE -ne 0 -or $supabaseVersion -ne '2.115.0') {
  throw 'The temporary Supabase CLI must be exactly 2.115.0.'
}

$supabaseHomePath = [System.IO.Path]::GetFullPath($SupabaseHome)
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
if (-not $supabaseHomePath.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The isolated Supabase CLI home must be inside the Windows temporary directory.'
}
New-Item -ItemType Directory -Force -Path $supabaseHomePath | Out-Null

try {
  $env:SUPABASE_HOME = $supabaseHomePath
  & $Supabase login --no-browser
  if ($LASTEXITCODE -ne 0) { throw 'Supabase authorization did not complete.' }

  $projectsJson = & $Supabase projects list --output json
  if ($LASTEXITCODE -ne 0) { throw 'Supabase project verification failed after authorization.' }
  $projects = $projectsJson | ConvertFrom-Json
  $staging = @($projects | Where-Object { (Get-ProjectReference $_) -eq 'nkkunkwirvfwhmpwonqz' })
  $production = @($projects | Where-Object { (Get-ProjectReference $_) -eq 'vnxjktpdzmykmqrqwvks' })
  $stagingHealthyAndLinked = $staging.Count -eq 1 -and $staging[0].status -eq 'ACTIVE_HEALTHY' -and [bool]$staging[0].linked
  $productionLinked = $production.Count -gt 0 -and [bool]$production[0].linked

  [ordered]@{
    gate = 'c6_supabase_cli_authorization'
    version = $supabaseVersion
    isolated_home = $supabaseHomePath
    authenticated = $true
    visible_project_count = @($projects).Count
    staging_match_count = $staging.Count
    staging_status = if ($staging.Count -eq 1) { $staging[0].status } else { $null }
    staging_linked = if ($staging.Count -eq 1) { [bool]$staging[0].linked } else { $false }
    production_linked = $productionLinked
    global_profile_modified = $false
  } | ConvertTo-Json -Compress
  if (-not $stagingHealthyAndLinked -or $productionLinked) {
    throw 'Authorization is not bound to healthy linked Annotated Staging. Reauthorize from the browser account that can open exact project nkkunkwirvfwhmpwonqz.'
  }
  if ($RunDurationGate) {
    $durationGate = Join-Path $PSScriptRoot 'run-c6-duration-gate.ps1'
    & $durationGate -Supabase $Supabase -SupabaseHome $supabaseHomePath
  }
  if ($RunDurationDiagnostic) {
    $durationDiagnostic = Join-Path $PSScriptRoot 'run-c6-duration-diagnostic.ps1'
    & $durationDiagnostic
  }
  if ($RunDurationRecovery) {
    $durationRecovery = Join-Path $PSScriptRoot 'run-c6-duration-recovery.ps1'
    & $durationRecovery -Supabase $Supabase -SupabaseHome $supabaseHomePath
  }
  if ($ObserveDurationRecovery) {
    $durationRecovery = Join-Path $PSScriptRoot 'run-c6-duration-recovery.ps1'
    & $durationRecovery -Supabase $Supabase -SupabaseHome $supabaseHomePath -ObserveExistingDispatch
  }
  if ($FinalizeDurationGate) {
    $durationFinalize = Join-Path $PSScriptRoot 'finalize-c6-duration-gate.ps1'
    & $durationFinalize -Supabase $Supabase -SupabaseHome $supabaseHomePath
  }
  if ($RunCodecGate) {
    $codecGate = Join-Path $PSScriptRoot 'run-c6-codec-gate.ps1'
    & $codecGate -Supabase $Supabase -SupabaseHome $supabaseHomePath
  }
  if ($RunGeometryGate) {
    $geometryGate = Join-Path $PSScriptRoot 'run-c6-geometry-gate.ps1'
    & $geometryGate -Supabase $Supabase -SupabaseHome $supabaseHomePath
  }
  if ($RunGeometryDiagnostic) {
    $geometryDiagnostic = Join-Path $PSScriptRoot 'run-c6-geometry-diagnostic.ps1'
    & $geometryDiagnostic
  }
  if ($RunGeometryRecovery) {
    $geometryRecovery = Join-Path $PSScriptRoot 'run-c6-geometry-recovery.ps1'
    & $geometryRecovery -Supabase $Supabase -SupabaseHome $supabaseHomePath
  }
} finally {
  if ($null -eq $previousSupabaseHome) {
    Remove-Item Env:\SUPABASE_HOME -ErrorAction SilentlyContinue
  } else {
    $env:SUPABASE_HOME = $previousSupabaseHome
  }
}
