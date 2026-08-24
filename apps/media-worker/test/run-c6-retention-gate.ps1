[CmdletBinding()]
param(
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $Supabase = (Join-Path $env:TEMP 'Annotated-supabase-2.115.0\extracted\supabase.exe'),
  [string] $SupabaseHome = (Join-Path $env:TEMP 'Annotated-supabase-c6-home')
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$harness = Join-Path $PSScriptRoot 'staging-retention-acceptance.mjs'
$prepared = $false
$previousSupabaseHome = $env:SUPABASE_HOME

function Invoke-CheckedNative {
  param([Parameter(Mandatory)] [scriptblock] $Command, [Parameter(Mandatory)] [string] $Failure)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Get-ProjectReference {
  param([Parameter(Mandatory)] [object] $Project)
  if ($null -ne $Project.PSObject.Properties['ref'] -and -not [string]::IsNullOrWhiteSpace([string]$Project.ref)) {
    return [string]$Project.ref
  }
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
  if ((git branch --show-current) -ne 'codex/phase-c-worker') { throw 'Run only from codex/phase-c-worker.' }
  if ((git status --porcelain).Count -ne 0) { throw 'Run the Staging gate only from a clean committed worktree.' }
  if ((git rev-parse HEAD).Trim() -ne (git rev-parse origin/codex/phase-c-worker).Trim()) {
    throw 'The committed gate must be pushed before Staging execution.'
  }
  if (-not (Test-Path -LiteralPath $Gcloud -PathType Leaf) -or
      -not (Test-Path -LiteralPath $Supabase -PathType Leaf)) {
    throw 'The pinned temporary gcloud or Supabase executable is missing.'
  }
  if ((& $Supabase --version).Trim() -ne '2.115.0') { throw 'Supabase CLI must be exactly 2.115.0.' }
  $env:SUPABASE_HOME = [System.IO.Path]::GetFullPath($SupabaseHome)
  $projects = (& $Supabase projects list --output json) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'The isolated Supabase authorization is unavailable.' }
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
  $jobs = @('annotated-media-worker-staging', 'annotated-media-dispatcher-staging', 'annotated-media-reconciler-staging')
  $images = @($jobs | ForEach-Object { Get-JobImage $_ })
  if (@($images | Select-Object -Unique).Count -ne 1 -or $images[0] -notmatch '@sha256:[a-f0-9]{64}$') {
    throw 'All Staging jobs must use one immutable image digest.'
  }

  $env:ANNOTATED_C6_STAGING_RETENTION = '1'
  $env:ANNOTATED_SERVICE_ROLE_KEY = (& $Gcloud secrets versions access latest --secret=annotated-staging-supabase-secret-key --project=annotated-504301).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:ANNOTATED_SERVICE_ROLE_KEY)) {
    throw 'Could not retrieve the Staging Storage secret.'
  }
  Invoke-CheckedNative { node $harness preflight } 'The bounded Staging retention fixture preflight failed.'
  $prepared = $true
  Invoke-CheckedNative { node $harness prepare } 'The bounded Staging retention fixture preparation failed.'
  Invoke-CheckedNative {
    & $Gcloud run jobs execute annotated-media-reconciler-staging --project=annotated-504301 --region=us-east4 --wait --format='value(metadata.name)'
  } 'The one-shot Staging reconciler execution failed.'
  Invoke-CheckedNative { node $harness status } 'The bounded Staging retention lifecycle assertions failed.'

  $logFilter = 'resource.type="cloud_run_job" AND resource.labels.job_name="annotated-media-reconciler-staging"'
  $logs = @(& $Gcloud logging read $logFilter --project=annotated-504301 --freshness=15m --limit=50 --order=desc --format=json)
  if ($LASTEXITCODE -ne 0) { throw 'The bounded reconciler log query failed.' }
  $logText = $logs -join [Environment]::NewLine
  if ($logText -match 'Bearer\s|service_role|annotation-media-raw/|https://nkkunkwirvfwhmpwonqz[.]supabase[.]co/storage') {
    throw 'The bounded reconciler logs contain a prohibited secret or private path marker.'
  }
  Invoke-CheckedNative { node $harness cleanup } 'The disposable Staging retention cleanup failed.'
  $prepared = $false
  $dispatchStateAfter = (& $Gcloud scheduler jobs describe annotated-media-dispatch-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  $reconcileStateAfter = (& $Gcloud scheduler jobs describe annotated-media-reconcile-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  if ($dispatchStateAfter -ne 'PAUSED' -or $reconcileStateAfter -ne 'PAUSED') { throw 'A Staging schedule is no longer PAUSED.' }
  [ordered]@{
    gate = 'c6_retention_corrective_regression'; outcome = 'passed'; lifecycle_case_count = 2
    reconciler_execution_count = 1; fixtures_cleaned = $true; schedules_paused = $true
    production_accessed = $false; immutable_image = $images[0]
  } | ConvertTo-Json -Compress
} finally {
  if ($prepared -and -not [string]::IsNullOrWhiteSpace($env:ANNOTATED_SERVICE_ROLE_KEY)) {
    node $harness cleanup
    if ($LASTEXITCODE -ne 0) { Write-Warning 'The disposable Staging retention fixture needs bounded cleanup diagnosis.' }
  }
  if ($null -eq $previousSupabaseHome) { Remove-Item Env:\SUPABASE_HOME -ErrorAction SilentlyContinue }
  else { $env:SUPABASE_HOME = $previousSupabaseHome }
  Remove-Item Env:\ANNOTATED_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_STAGING_RETENTION -ErrorAction SilentlyContinue
  Pop-Location
}
