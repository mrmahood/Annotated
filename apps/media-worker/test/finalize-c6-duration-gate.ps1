[CmdletBinding()]
param(
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $Supabase = (Join-Path $env:TEMP 'Annotated-supabase-2.115.0\extracted\supabase.exe'),
  [string] $SupabaseHome = (Join-Path $env:TEMP 'Annotated-supabase-c6-home'),
  [string] $ArtifactPath = (Join-Path $env:TEMP 'Annotated-c6-duration-90000-acceptance.m4a')
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$harness = Join-Path $PSScriptRoot 'staging-duration-acceptance.mjs'
$expectedDigest = 'sha256:db5b20136e38284fa03f45292edeb29c398597592e6155d994b09f8fc9cffd57'
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
  if ((git branch --show-current) -ne 'codex/phase-c-worker') { throw 'Finalize only from codex/phase-c-worker.' }
  if (-not (Test-Path -LiteralPath $Gcloud -PathType Leaf)) { throw 'The pinned portable gcloud executable is missing.' }
  if (-not (Test-Path -LiteralPath $Supabase -PathType Leaf) -or (& $Supabase --version).Trim() -ne '2.115.0') {
    throw 'The checksum-verified Supabase CLI must be exactly 2.115.0.'
  }
  $supabaseHomePath = [System.IO.Path]::GetFullPath($SupabaseHome)
  $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  if (-not $supabaseHomePath.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $supabaseHomePath -PathType Container)) {
    throw 'The isolated Supabase CLI home is missing or outside the temporary directory.'
  }
  $env:SUPABASE_HOME = $supabaseHomePath
  $projectsJson = & $Supabase projects list --output json
  if ($LASTEXITCODE -ne 0) { throw 'Isolated Supabase authorization is unavailable.' }
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
  if ($dispatchState -ne 'PAUSED' -or $reconcileState -ne 'PAUSED') { throw 'Both Staging schedules must remain PAUSED.' }
  $expectedImageSuffix = "@$expectedDigest"
  $jobImages = @($jobs | ForEach-Object { Get-JobImage $_ })
  if (@($jobImages | Where-Object { -not $_.EndsWith($expectedImageSuffix, [StringComparison]::Ordinal) }).Count -ne 0) {
    throw 'All three Staging jobs must use the corrective immutable digest.'
  }
  if (-not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf)) { throw 'The passed acceptance artifact is missing.' }

  $env:ANNOTATED_C6_STAGING_DURATION = '1'
  $env:ANNOTATED_ACCEPTANCE_ARTIFACT = [System.IO.Path]::GetFullPath($ArtifactPath)
  $env:ANNOTATED_SERVICE_ROLE_KEY = (& $Gcloud secrets versions access latest --secret=annotated-staging-supabase-secret-key --project=annotated-504301).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:ANNOTATED_SERVICE_ROLE_KEY)) {
    throw 'Could not retrieve the Staging Storage secret.'
  }

  Invoke-CheckedNative { node $harness resume-status } 'The passed 90-second fixture or local artifact no longer matches.'

  $logFilter = 'resource.type="cloud_run_job" AND resource.labels.job_name="annotated-media-worker-staging" AND jsonPayload.media_id="c6530000-0000-4000-8000-000000000001"'
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
    if ([DateTimeOffset]::UtcNow -ge $logDeadline) { throw 'Timed out waiting for the bounded worker logs.' }
    Start-Sleep -Seconds 5
  } while ($true)
  $expectedEvents = @('worker_started', 'worker_claimed', 'derivative_staged', 'transcript_staged', 'raw_cleanup_confirmed', 'worker_completed')
  if (($events -join ',') -ne ($expectedEvents -join ',')) { throw 'The first-attempt worker log sequence is invalid.' }
  [ordered]@{ gate = 'c6_duration_90000_logs'; event_count = $events.Count; events = $events;
    failure_event_present = $events -contains 'worker_failed'; passed = $true } | ConvertTo-Json -Compress

  Invoke-CheckedNative { node $harness cleanup } 'The exact passed fixture cleanup failed.'
  $retained = $false
  [ordered]@{
    gate = 'c6_duration_90000_finalize'
    outcome = 'passed'
    dispatcher_executed = $false
    worker_executed = $false
    remote_fixture_cleaned = $true
    schedules_paused = $true
    production_accessed = $false
    artifact_path = [System.IO.Path]::GetFullPath($ArtifactPath)
  } | ConvertTo-Json -Compress
} finally {
  if ($null -eq $previousSupabaseHome) { Remove-Item Env:\SUPABASE_HOME -ErrorAction SilentlyContinue }
  else { $env:SUPABASE_HOME = $previousSupabaseHome }
  Remove-Item Env:\ANNOTATED_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_STAGING_DURATION -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_ACCEPTANCE_ARTIFACT -ErrorAction SilentlyContinue
  Pop-Location
  if ($retained) { Write-Warning 'The passed fixture was not cleaned. Do not rerun or delete it manually; send the bounded output to Codex.' }
}
