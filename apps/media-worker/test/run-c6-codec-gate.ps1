[CmdletBinding()]
param(
  [string] $FfmpegBin = (Join-Path $env:TEMP 'Annotated-ffmpeg-8.1-42c721d1f3164c61b72b7aaeba07772d\extracted\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1\bin'),
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $Supabase = (Join-Path $env:TEMP 'Annotated-supabase-2.115.0\extracted\supabase.exe'),
  [string] $SupabaseHome = (Join-Path $env:TEMP 'Annotated-supabase-c6-home'),
  [string] $ArtifactPath = (Join-Path $env:TEMP 'Annotated-c6-codec-vp8-acceptance.mp4')
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$harness = Join-Path $PSScriptRoot 'staging-codec-acceptance.mjs'
$generator = Join-Path $PSScriptRoot 'generate-c6-vp8-codec-fixture.ps1'
$rawFixture = Join-Path $env:TEMP 'Annotated-c6-codec-vp8-raw.webm'
$expectedDigest = 'sha256:db5b20136e38284fa03f45292edeb29c398597592e6155d994b09f8fc9cffd57'
$prepared = $false
$passed = $false
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

Push-Location $repositoryRoot
try {
  if ((git branch --show-current) -ne 'codex/phase-c-worker') { throw 'Run this gate only from codex/phase-c-worker.' }
  if (-not (Test-Path -LiteralPath $Gcloud)) { throw 'The pinned portable gcloud executable is missing.' }
  if (-not (Test-Path -LiteralPath $Supabase)) { throw 'The checksum-verified temporary Supabase CLI is missing.' }
  $supabaseVersion = (& $Supabase --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $supabaseVersion -ne '2.115.0') { throw 'The temporary Supabase CLI must be exactly 2.115.0.' }

  $supabaseHomePath = [System.IO.Path]::GetFullPath($SupabaseHome)
  $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  if (-not $supabaseHomePath.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The isolated Supabase CLI home must be inside the Windows temporary directory.'
  }
  if (-not (Test-Path -LiteralPath $supabaseHomePath -PathType Container)) {
    throw 'The isolated Supabase CLI home is missing. Run authorize-c6-supabase-cli.ps1 first.'
  }
  $env:SUPABASE_HOME = $supabaseHomePath

  $projectsJson = & $Supabase projects list --output json
  if ($LASTEXITCODE -ne 0) { throw 'Isolated Supabase authorization failed. Run authorize-c6-supabase-cli.ps1 and retry.' }
  $projects = $projectsJson | ConvertFrom-Json
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
  if ($dispatchState -ne 'PAUSED' -or $reconcileState -ne 'PAUSED') { throw 'Both Staging schedules must be PAUSED.' }

  $workerJobJson = & $Gcloud run jobs describe annotated-media-worker-staging --project=annotated-504301 --region=us-east4 --format=json
  if ($LASTEXITCODE -ne 0) { throw 'The bounded Staging worker description failed.' }
  $workerJob = ($workerJobJson -join [Environment]::NewLine) | ConvertFrom-Json
  $workerContainers = @($workerJob.spec.template.spec.template.spec.containers)
  $workerImage = if ($workerContainers.Count -eq 1) { [string]$workerContainers[0].image } else { '' }
  if ($workerContainers.Count -ne 1 -or -not $workerImage.EndsWith("@$expectedDigest", [StringComparison]::Ordinal)) {
    throw 'The Staging worker is not pinned to the accepted immutable digest.'
  }

  if (Test-Path -LiteralPath $ArtifactPath) { throw "Acceptance artifact already exists: $ArtifactPath" }
  if (Test-Path -LiteralPath $rawFixture) { throw "Disposable raw fixture already exists: $rawFixture" }
  & $generator -FfmpegBin $FfmpegBin -OutputPath $rawFixture
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic VP8 fixture generation failed.' }

  $env:ANNOTATED_C6_STAGING_CODEC = '1'
  $env:ANNOTATED_FFPROBE_BIN = Join-Path $FfmpegBin 'ffprobe.exe'
  $env:ANNOTATED_RAW_FIXTURE = $rawFixture
  $env:ANNOTATED_ACCEPTANCE_ARTIFACT = [System.IO.Path]::GetFullPath($ArtifactPath)
  $env:ANNOTATED_SERVICE_ROLE_KEY = (& $Gcloud secrets versions access latest --secret=annotated-staging-supabase-secret-key --project=annotated-504301).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:ANNOTATED_SERVICE_ROLE_KEY)) {
    throw 'Could not retrieve the Staging Storage secret.'
  }

  Invoke-CheckedNative { node $harness preflight } 'The exact Staging codec preflight failed.'
  Invoke-CheckedNative { node $harness prepare } 'The VP8 codec fixture could not be prepared.'
  $prepared = $true
  Invoke-CheckedNative {
    & $Gcloud run jobs execute annotated-media-dispatcher-staging --project=annotated-504301 --region=us-east4 --wait --format='value(metadata.name,status.conditions[0].state)'
  } 'The bounded dispatcher execution failed.'

  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(8)
  do {
    node $harness status
    $statusCode = $LASTEXITCODE
    if ($statusCode -eq 0) { $passed = $true; break }
    if ($statusCode -eq 3) { throw 'The codec worker scheduled a retry; retain the fixture and send the bounded output to Codex.' }
    if ($statusCode -ne 2) { throw 'The codec worker reached an unexpected terminal result.' }
    if ([DateTimeOffset]::UtcNow -ge $deadline) { throw 'Timed out waiting for the bounded VP8 worker execution.' }
    Start-Sleep -Seconds 15
  } while ($true)

  $logFilter = 'resource.type="cloud_run_job" AND resource.labels.job_name="annotated-media-worker-staging" AND jsonPayload.media_id="c6630000-0000-4000-8000-000000000001"'
  $logDeadline = [DateTimeOffset]::UtcNow.AddMinutes(2)
  do {
    $logJson = & $Gcloud logging read $logFilter --project=annotated-504301 --freshness=2h --limit=50 --order=asc --format='json(jsonPayload.event,jsonPayload.stage,jsonPayload.code,jsonPayload.outcome)'
    if ($LASTEXITCODE -ne 0) { throw 'The bounded sanitized-log query failed.' }
    $parsedLogRows = (($logJson -join [Environment]::NewLine) | ConvertFrom-Json)
    $allEvents = @()
    foreach ($logRow in $parsedLogRows) { $allEvents += [string]$logRow.jsonPayload.event }
    $lastStart = -1
    for ($index = 0; $index -lt $allEvents.Count; $index += 1) {
      if ($allEvents[$index] -eq 'worker_started') { $lastStart = $index }
    }
    $events = if ($lastStart -ge 0) { @($allEvents[$lastStart..($allEvents.Count - 1)]) } else { @() }
    if ($events -contains 'worker_completed') { break }
    if ([DateTimeOffset]::UtcNow -ge $logDeadline) { throw 'Timed out waiting for the bounded codec worker logs.' }
    Start-Sleep -Seconds 5
  } while ($true)
  $expectedEvents = @('worker_started', 'worker_claimed', 'derivative_staged', 'transcript_staged', 'raw_cleanup_confirmed', 'worker_completed')
  if (($events -join ',') -ne ($expectedEvents -join ',')) { throw 'The first-attempt codec worker log sequence is invalid.' }
  [ordered]@{
    gate = 'c6_codec_vp8_logs'
    event_count = $events.Count
    events = $events
    failure_event_present = $events -contains 'worker_failed'
    passed = $true
  } | ConvertTo-Json -Compress

  Invoke-CheckedNative { node $harness cleanup } 'The exact remote codec fixture cleanup failed.'
  $prepared = $false
  Write-Host 'C6 VP8 codec automated Staging gate: PASS'
  Write-Host "Owner acceptance artifact: $([System.IO.Path]::GetFullPath($ArtifactPath))"
} finally {
  if ($null -eq $previousSupabaseHome) { Remove-Item Env:\SUPABASE_HOME -ErrorAction SilentlyContinue } else { $env:SUPABASE_HOME = $previousSupabaseHome }
  Remove-Item Env:\ANNOTATED_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_STAGING_CODEC -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_FFPROBE_BIN -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_RAW_FIXTURE -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_ACCEPTANCE_ARTIFACT -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $rawFixture -Force -ErrorAction SilentlyContinue
  Pop-Location
  if ($prepared) {
    Write-Warning 'The disposable Staging codec fixture was retained for diagnosis. Do not rerun or delete it manually; send the bounded output to Codex.'
  }
}
