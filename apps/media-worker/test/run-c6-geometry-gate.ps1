[CmdletBinding()]
param(
  [string] $FfmpegBin = (Join-Path $env:TEMP 'Annotated-ffmpeg-8.1-42c721d1f3164c61b72b7aaeba07772d\extracted\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1\bin'),
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $Supabase = (Join-Path $env:TEMP 'Annotated-supabase-2.115.0\extracted\supabase.exe'),
  [string] $SupabaseHome = (Join-Path $env:TEMP 'Annotated-supabase-c6-home'),
  [switch] $SkipPortrait
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$harness = Join-Path $PSScriptRoot 'staging-geometry-acceptance.mjs'
$generator = Join-Path $PSScriptRoot 'generate-c6-geometry-fixture.ps1'
$expectedDigest = 'sha256:f4b101880bbdf77784769f82fe5055261537f0fb6f868252b3891eb687d7b057'
$previousSupabaseHome = $env:SUPABASE_HOME
$preparedCase = $null

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
  if (-not (Test-Path -LiteralPath $Gcloud) -or -not (Test-Path -LiteralPath $Supabase)) { throw 'Pinned gcloud or Supabase CLI is missing.' }
  if ((& $Supabase --version).Trim() -ne '2.115.0') { throw 'The temporary Supabase CLI must be exactly 2.115.0.' }
  $supabaseHomePath = [System.IO.Path]::GetFullPath($SupabaseHome)
  $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  if (-not $supabaseHomePath.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The isolated Supabase CLI home must be inside the Windows temporary directory.'
  }
  $env:SUPABASE_HOME = $supabaseHomePath
  $projects = (& $Supabase projects list --output json) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Isolated Supabase authorization failed.' }
  $staging = @($projects | Where-Object { (Get-ProjectReference $_) -eq 'nkkunkwirvfwhmpwonqz' })
  $production = @($projects | Where-Object { (Get-ProjectReference $_) -eq 'vnxjktpdzmykmqrqwvks' })
  if ($staging.Count -ne 1 -or $staging[0].status -ne 'ACTIVE_HEALTHY' -or -not $staging[0].linked) { throw 'Exact Staging ref nkkunkwirvfwhmpwonqz is not healthy and linked.' }
  if ($production.Count -gt 0 -and $production[0].linked) { throw 'Production unexpectedly appears linked.' }
  $account = (& $Gcloud auth list --filter=status:ACTIVE --format='value(account)').Trim()
  $project = (& $Gcloud config get-value project).Trim()
  if ($account -ne 'cbandcoop@gmail.com' -or $project -ne 'annotated-504301') { throw 'The active Google account or project is not the approved Staging boundary.' }
  $dispatchState = (& $Gcloud scheduler jobs describe annotated-media-dispatch-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  $reconcileState = (& $Gcloud scheduler jobs describe annotated-media-reconcile-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  if ($dispatchState -ne 'PAUSED' -or $reconcileState -ne 'PAUSED') { throw 'Both Staging schedules must be PAUSED.' }
  $workerJob = ((& $Gcloud run jobs describe annotated-media-worker-staging --project=annotated-504301 --region=us-east4 --format=json) -join [Environment]::NewLine) | ConvertFrom-Json
  $workerContainers = @($workerJob.spec.template.spec.template.spec.containers)
  $workerImage = if ($workerContainers.Count -eq 1) { [string]$workerContainers[0].image } else { '' }
  if ($workerContainers.Count -ne 1 -or -not $workerImage.EndsWith("@$expectedDigest", [StringComparison]::Ordinal)) {
    throw 'The Staging worker is not pinned to the accepted provider-tail corrective digest.'
  }

  $artifacts = @{
    portrait = (Join-Path $env:TEMP 'Annotated-c6-geometry-portrait-acceptance.mp4')
    letterbox = (Join-Path $env:TEMP 'Annotated-c6-geometry-letterbox-acceptance.mp4')
  }
  $cases = if ($SkipPortrait) { @('letterbox', 'unsafe') } else { @('portrait', 'letterbox', 'unsafe') }
  $artifactsToCreate = if ($SkipPortrait) { @($artifacts.letterbox) } else { @($artifacts.Values) }
  foreach ($artifact in $artifactsToCreate) {
    if (Test-Path -LiteralPath $artifact) { throw "Acceptance artifact already exists: $artifact" }
  }

  $env:ANNOTATED_C6_STAGING_GEOMETRY = '1'
  $env:ANNOTATED_FFPROBE_BIN = Join-Path $FfmpegBin 'ffprobe.exe'
  $env:ANNOTATED_SERVICE_ROLE_KEY = (& $Gcloud secrets versions access latest --secret=annotated-staging-supabase-secret-key --project=annotated-504301).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:ANNOTATED_SERVICE_ROLE_KEY)) { throw 'Could not retrieve the Staging Storage secret.' }

  foreach ($case in $cases) {
    $rawFixture = Join-Path $env:TEMP "Annotated-c6-geometry-$case-raw.webm"
    if (Test-Path -LiteralPath $rawFixture) { throw "Disposable raw fixture already exists: $rawFixture" }
    try {
      & $generator -Case $case -FfmpegBin $FfmpegBin -OutputPath $rawFixture
      if ($LASTEXITCODE -ne 0) { throw "Synthetic $case geometry fixture generation failed." }
      $env:ANNOTATED_GEOMETRY_CASE = $case
      $env:ANNOTATED_RAW_FIXTURE = $rawFixture
      if ($case -ne 'unsafe') { $env:ANNOTATED_ACCEPTANCE_ARTIFACT = [System.IO.Path]::GetFullPath($artifacts[$case]) }
      else { Remove-Item Env:\ANNOTATED_ACCEPTANCE_ARTIFACT -ErrorAction SilentlyContinue }

      Invoke-CheckedNative { node $harness preflight } "The $case geometry preflight failed."
      Invoke-CheckedNative { node $harness prepare } "The $case geometry fixture could not be prepared."
      $preparedCase = $case
      Invoke-CheckedNative {
        & $Gcloud run jobs execute annotated-media-dispatcher-staging --project=annotated-504301 --region=us-east4 --wait --format='value(metadata.name,status.conditions[0].state)'
      } "The $case geometry dispatcher execution failed."

      $deadline = [DateTimeOffset]::UtcNow.AddMinutes(8)
      do {
        node $harness status
        $statusCode = $LASTEXITCODE
        if ($statusCode -eq 0) { break }
        if ($statusCode -eq 3) { throw "The $case geometry worker scheduled a retry; retain the fixture and report the bounded output." }
        if ($statusCode -ne 2) { throw "The $case geometry worker reached an unexpected terminal result." }
        if ([DateTimeOffset]::UtcNow -ge $deadline) { throw "Timed out waiting for the bounded $case geometry worker." }
        Start-Sleep -Seconds 15
      } while ($true)

      $mediaId = if ($case -eq 'portrait') { 'c6730000-0000-4000-8000-000000000001' } elseif ($case -eq 'letterbox') { 'c6770000-0000-4000-8000-000000000001' } else { 'c67b0000-0000-4000-8000-000000000001' }
      $logFilter = "resource.type=`"cloud_run_job`" AND resource.labels.job_name=`"annotated-media-worker-staging`" AND jsonPayload.media_id=`"$mediaId`""
      $logDeadline = [DateTimeOffset]::UtcNow.AddMinutes(2)
      do {
        $logJson = & $Gcloud logging read $logFilter --project=annotated-504301 --freshness=2h --limit=50 --order=asc --format='json(jsonPayload.event,jsonPayload.stage,jsonPayload.code,jsonPayload.outcome)'
        if ($LASTEXITCODE -ne 0) { throw 'The bounded geometry log query failed.' }
        $parsed = (($logJson -join [Environment]::NewLine) | ConvertFrom-Json)
        $events = @($parsed | ForEach-Object { [string]$_.jsonPayload.event })
        $terminalEvent = if ($case -eq 'unsafe') { 'worker_failed' } else { 'worker_completed' }
        if ($events -contains $terminalEvent) { break }
        if ([DateTimeOffset]::UtcNow -ge $logDeadline) { throw "Timed out waiting for the bounded $case geometry logs." }
        Start-Sleep -Seconds 5
      } while ($true)
      $expectedEvents = if ($case -eq 'unsafe') { @('worker_started', 'worker_claimed', 'worker_failed') } else { @('worker_started', 'worker_claimed', 'derivative_staged', 'transcript_staged', 'raw_cleanup_confirmed', 'worker_completed') }
      $lastStart = -1
      for ($index = 0; $index -lt $events.Count; $index += 1) {
        if ($events[$index] -eq 'worker_started') { $lastStart = $index }
      }
      $latestEvents = if ($lastStart -ge 0) { @($events[$lastStart..($events.Count - 1)]) } else { @() }
      if (($latestEvents -join ',') -ne ($expectedEvents -join ',')) { throw "The $case geometry log sequence is invalid." }
      [ordered]@{ gate = "c6_geometry_${case}_logs"; event_count = $latestEvents.Count; events = $latestEvents; passed = $true } | ConvertTo-Json -Compress

      Invoke-CheckedNative { node $harness cleanup } "The $case geometry cleanup failed."
      $preparedCase = $null
    } finally {
      Remove-Item -LiteralPath $rawFixture -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host 'C6 automated Staging geometry matrix: PASS'
  if (-not $SkipPortrait) { Write-Host "Portrait owner artifact: $($artifacts.portrait)" }
  Write-Host "Letterbox owner artifact: $($artifacts.letterbox)"
} finally {
  if ($null -eq $previousSupabaseHome) { Remove-Item Env:\SUPABASE_HOME -ErrorAction SilentlyContinue } else { $env:SUPABASE_HOME = $previousSupabaseHome }
  Remove-Item Env:\ANNOTATED_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_STAGING_GEOMETRY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_FFPROBE_BIN -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_GEOMETRY_CASE -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_RAW_FIXTURE -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_ACCEPTANCE_ARTIFACT -ErrorAction SilentlyContinue
  Pop-Location
  if ($null -ne $preparedCase) { Write-Warning "The disposable $preparedCase Staging geometry fixture was retained. Do not rerun or delete it manually; send the bounded output to Codex." }
}
