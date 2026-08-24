[CmdletBinding()]
param(
  [string] $FfmpegBin = (Join-Path $env:TEMP 'Annotated-ffmpeg-8.1-42c721d1f3164c61b72b7aaeba07772d\extracted\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1\bin'),
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $Supabase = (Join-Path $env:TEMP 'Annotated-supabase-2.115.0\extracted\supabase.exe'),
  [string] $SupabaseHome = (Join-Path $env:TEMP 'Annotated-supabase-c6-home'),
  [string] $ArtifactPath = (Join-Path $env:TEMP 'Annotated-c6-geometry-portrait-acceptance.mp4')
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$harness = Join-Path $PSScriptRoot 'staging-geometry-acceptance.mjs'
$geometryGate = Join-Path $PSScriptRoot 'run-c6-geometry-gate.ps1'
$expectedDigest = 'sha256:f4b101880bbdf77784769f82fe5055261537f0fb6f868252b3891eb687d7b057'
$jobs = @('annotated-media-worker-staging', 'annotated-media-dispatcher-staging', 'annotated-media-reconciler-staging')
$retained = $true
$previousSupabaseHome = $env:SUPABASE_HOME

function Invoke-CheckedNative {
  param([Parameter(Mandatory)] [scriptblock] $Command, [Parameter(Mandatory)] [string] $Failure)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Get-ProjectReference {
  param([Parameter(Mandatory)] [object] $Project)
  $refProperty = $Project.PSObject.Properties['ref']
  if ($null -ne $refProperty -and -not [string]::IsNullOrWhiteSpace([string]$Project.ref)) { return [string]$Project.ref }
  return [string]$Project.id
}

function Get-JobImage {
  param([Parameter(Mandatory)] [string] $Job)
  $description = & $Gcloud run jobs describe $Job --project=annotated-504301 --region=us-east4 --format=json
  if ($LASTEXITCODE -ne 0) { throw "Could not describe Staging job $Job." }
  $resource = (($description -join [Environment]::NewLine) | ConvertFrom-Json)
  $containers = @($resource.spec.template.spec.template.spec.containers)
  if ($containers.Count -ne 1) { throw "Staging job $Job does not have exactly one container." }
  return [string]$containers[0].image
}

Push-Location $repositoryRoot
try {
  if ((git branch --show-current) -ne 'codex/phase-c-worker') { throw 'Run recovery only from codex/phase-c-worker.' }
  if (-not (Test-Path -LiteralPath $Gcloud -PathType Leaf) -or -not (Test-Path -LiteralPath $Supabase -PathType Leaf)) {
    throw 'The pinned portable gcloud or checksum-verified Supabase CLI is missing.'
  }
  if ((& $Supabase --version).Trim() -ne '2.115.0') { throw 'The temporary Supabase CLI must be exactly 2.115.0.' }
  $supabaseHomePath = [System.IO.Path]::GetFullPath($SupabaseHome)
  $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  if (-not $supabaseHomePath.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $supabaseHomePath -PathType Container)) {
    throw 'The isolated Supabase CLI home is missing or outside the temporary directory.'
  }
  $env:SUPABASE_HOME = $supabaseHomePath
  $projects = (& $Supabase projects list --output json) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Isolated Supabase authorization is unavailable.' }
  $staging = @($projects | Where-Object { (Get-ProjectReference $_) -eq 'nkkunkwirvfwhmpwonqz' })
  $production = @($projects | Where-Object { (Get-ProjectReference $_) -eq 'vnxjktpdzmykmqrqwvks' })
  if ($staging.Count -ne 1 -or $staging[0].status -ne 'ACTIVE_HEALTHY' -or -not $staging[0].linked) {
    throw 'Exact Staging ref nkkunkwirvfwhmpwonqz is not healthy and linked.'
  }
  if ($production.Count -gt 0 -and $production[0].linked) { throw 'Production unexpectedly appears linked.' }
  $account = (& $Gcloud auth list --filter=status:ACTIVE --format='value(account)').Trim()
  $project = (& $Gcloud config get-value project).Trim()
  if ($LASTEXITCODE -ne 0 -or $account -ne 'cbandcoop@gmail.com' -or $project -ne 'annotated-504301') {
    throw 'The active Google account or project is not the approved Staging boundary.'
  }
  $dispatchState = (& $Gcloud scheduler jobs describe annotated-media-dispatch-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  $reconcileState = (& $Gcloud scheduler jobs describe annotated-media-reconcile-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  if ($dispatchState -ne 'PAUSED' -or $reconcileState -ne 'PAUSED') { throw 'Both Staging schedules must remain PAUSED.' }
  $expectedImageSuffix = "@$expectedDigest"
  $jobImages = @($jobs | ForEach-Object { Get-JobImage $_ })
  if (@($jobImages | Where-Object { -not $_.EndsWith($expectedImageSuffix, [StringComparison]::Ordinal) }).Count -ne 0) {
    throw 'All three Staging jobs must use the corrective immutable digest.'
  }
  if (Test-Path -LiteralPath $ArtifactPath) { throw "Recovery artifact already exists: $ArtifactPath" }

  $env:ANNOTATED_C6_STAGING_GEOMETRY = '1'
  $env:ANNOTATED_GEOMETRY_CASE = 'portrait'
  $env:ANNOTATED_C6_RECOVERY_ARTIFACT = [System.IO.Path]::GetFullPath($ArtifactPath)
  $env:ANNOTATED_SERVICE_ROLE_KEY = (& $Gcloud secrets versions access latest --secret=annotated-staging-supabase-secret-key --project=annotated-504301).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:ANNOTATED_SERVICE_ROLE_KEY)) {
    throw 'Could not retrieve the Staging Storage secret.'
  }

  Invoke-CheckedNative { node $harness recovery-preflight } 'The retained portrait fixture failed its exact recovery preflight.'
  Invoke-CheckedNative {
    & $Gcloud run jobs execute annotated-media-dispatcher-staging --project=annotated-504301 --region=us-east4 --wait --format='value(metadata.name,status.conditions[0].state)'
  } 'The bounded retained-portrait dispatcher execution failed.'

  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(8)
  do {
    node $harness recovery-status
    $statusCode = $LASTEXITCODE
    if ($statusCode -eq 0) { break }
    if ($statusCode -eq 3) { throw 'The corrective portrait worker scheduled another retry; retain the fixture for diagnosis.' }
    if ($statusCode -ne 2) { throw 'The retained portrait fixture reached an unexpected terminal result.' }
    if ([DateTimeOffset]::UtcNow -ge $deadline) { throw 'Timed out waiting for retained portrait recovery.' }
    Start-Sleep -Seconds 15
  } while ($true)

  $logFilter = 'resource.type="cloud_run_job" AND resource.labels.job_name="annotated-media-worker-staging" AND jsonPayload.media_id="c6730000-0000-4000-8000-000000000001"'
  $logDeadline = [DateTimeOffset]::UtcNow.AddMinutes(2)
  do {
    $logJson = & $Gcloud logging read $logFilter --project=annotated-504301 --freshness=2h --limit=50 --order=asc --format='json(jsonPayload.event,jsonPayload.stage,jsonPayload.code,jsonPayload.outcome)'
    if ($LASTEXITCODE -ne 0) { throw 'The bounded portrait-recovery log query failed.' }
    $parsed = (($logJson -join [Environment]::NewLine) | ConvertFrom-Json)
    $events = @($parsed | ForEach-Object { [string]$_.jsonPayload.event })
    if ($events -contains 'worker_completed') { break }
    if ([DateTimeOffset]::UtcNow -ge $logDeadline) { throw 'Timed out waiting for bounded portrait-recovery logs.' }
    Start-Sleep -Seconds 5
  } while ($true)
  $lastStart = -1
  for ($index = 0; $index -lt $events.Count; $index += 1) {
    if ($events[$index] -eq 'worker_started') { $lastStart = $index }
  }
  $latestEvents = if ($lastStart -ge 0) { @($events[$lastStart..($events.Count - 1)]) } else { @() }
  $expectedEvents = @('worker_started', 'worker_claimed', 'transcript_staged', 'raw_cleanup_confirmed', 'worker_completed')
  if (($latestEvents -join ',') -ne ($expectedEvents -join ',')) { throw 'The retained portrait recovery log sequence is invalid.' }
  [ordered]@{ gate = 'c6_geometry_portrait_recovery_logs'; event_count = $latestEvents.Count; events = $latestEvents; passed = $true } | ConvertTo-Json -Compress

  Invoke-CheckedNative { node $harness cleanup } 'The recovered portrait fixture cleanup failed.'
  $retained = $false
  [ordered]@{
    gate = 'c6_geometry_portrait_recovery'
    outcome = 'passed'
    recovered_attempt_count = 2
    retained_derivative_reused = $true
    remote_fixture_cleaned = $true
    schedules_paused = $true
    production_accessed = $false
    artifact_path = [System.IO.Path]::GetFullPath($ArtifactPath)
  } | ConvertTo-Json -Compress

  & $geometryGate -FfmpegBin $FfmpegBin -Gcloud $Gcloud -Supabase $Supabase -SupabaseHome $supabaseHomePath -SkipPortrait
  if ($LASTEXITCODE -ne 0) { throw 'The remaining letterbox/unsafe geometry matrix failed.' }
} finally {
  if ($null -eq $previousSupabaseHome) { Remove-Item Env:\SUPABASE_HOME -ErrorAction SilentlyContinue }
  else { $env:SUPABASE_HOME = $previousSupabaseHome }
  Remove-Item Env:\ANNOTATED_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_STAGING_GEOMETRY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_GEOMETRY_CASE -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_RECOVERY_ARTIFACT -ErrorAction SilentlyContinue
  Pop-Location
  if ($retained) { Write-Warning 'The exact retained portrait fixture was not cleaned. Do not rerun or delete it manually; send the bounded output to Codex.' }
}
