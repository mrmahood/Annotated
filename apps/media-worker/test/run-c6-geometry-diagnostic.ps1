[CmdletBinding()]
param(
  [string] $FfmpegBin = (Join-Path $env:TEMP 'Annotated-ffmpeg-8.1-42c721d1f3164c61b72b7aaeba07772d\extracted\ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1\bin'),
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $ArtifactPath = (Join-Path $env:TEMP 'Annotated-c6-geometry-portrait-diagnostic.mp4')
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$harness = Join-Path $PSScriptRoot 'staging-geometry-acceptance.mjs'
$diagnostic = Join-Path $PSScriptRoot 'staging-openai-structure-diagnostic.mjs'
$artifact = [System.IO.Path]::GetFullPath($ArtifactPath)
$artifactCreated = $false

Push-Location $repositoryRoot
try {
  if ((git branch --show-current) -ne 'codex/phase-c-worker') { throw 'Run this diagnostic only from codex/phase-c-worker.' }
  if (-not (Test-Path -LiteralPath $Gcloud -PathType Leaf)) { throw 'The pinned portable gcloud executable is missing.' }
  if (-not (Test-Path -LiteralPath (Join-Path $FfmpegBin 'ffmpeg.exe')) -or -not (Test-Path -LiteralPath (Join-Path $FfmpegBin 'ffprobe.exe'))) {
    throw 'The checksum-verified FFmpeg tools are missing.'
  }
  if (Test-Path -LiteralPath $artifact) { throw "The diagnostic artifact already exists: $artifact" }
  $account = (& $Gcloud auth list --filter=status:ACTIVE --format='value(account)').Trim()
  $project = (& $Gcloud config get-value project).Trim()
  if ($account -ne 'cbandcoop@gmail.com' -or $project -ne 'annotated-504301') { throw 'The active Google account or project is not the approved Staging boundary.' }
  $dispatchState = (& $Gcloud scheduler jobs describe annotated-media-dispatch-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  $reconcileState = (& $Gcloud scheduler jobs describe annotated-media-reconcile-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  if ($dispatchState -ne 'PAUSED' -or $reconcileState -ne 'PAUSED') { throw 'Both Staging schedules must remain PAUSED.' }

  $env:ANNOTATED_C6_STAGING_GEOMETRY = '1'
  $env:ANNOTATED_GEOMETRY_CASE = 'portrait'
  $env:ANNOTATED_C6_DIAGNOSTIC_ARTIFACT = $artifact
  $env:ANNOTATED_SERVICE_ROLE_KEY = (& $Gcloud secrets versions access latest --secret=annotated-staging-supabase-secret-key --project=annotated-504301).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:ANNOTATED_SERVICE_ROLE_KEY)) { throw 'Could not retrieve the Staging Storage secret.' }

  $exportText = (& node $harness diagnostic-export) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw 'The retained portrait derivative export failed.' }
  Write-Host $exportText
  $export = $exportText | ConvertFrom-Json
  $artifactCreated = Test-Path -LiteralPath $artifact -PathType Leaf
  if ($export.gate -ne 'c6_geometry_portrait_diagnostic_export' -or $export.outcome -ne 'passed' -or
      -not $artifactCreated -or [int]$export.derivative_duration_ms -ne 9000 -or
      [string]$export.failure_stage -ne 'transcribing' -or [string]$export.failure_code -ne 'transcript_invalid') {
    throw 'The retained portrait fixture did not satisfy the diagnostic contract.'
  }

  $env:OPENAI_API_KEY = (& $Gcloud secrets versions access latest --secret=annotated-staging-openai-api-key --project=annotated-504301).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw 'Could not retrieve the Staging OpenAI secret.' }
  $env:ANNOTATED_FFMPEG_BIN = $FfmpegBin
  $env:ANNOTATED_C6_STAGING_DIAGNOSTIC = '1'
  $env:ANNOTATED_C6_DERIVATIVE_PATH = $artifact
  $env:ANNOTATED_C6_DERIVATIVE_SHA256 = [string]$export.processed_checksum_sha256
  $env:ANNOTATED_C6_DERIVATIVE_DURATION_MS = [string]$export.derivative_duration_ms
  $env:ANNOTATED_C6_DERIVATIVE_MEDIA_TYPE = 'video'
  & node $diagnostic
  if ($LASTEXITCODE -ne 0) { throw 'The text-free portrait structure diagnostic failed to execute.' }
  Write-Host 'C6 retained portrait diagnostic: COMPLETE; remote fixture retained and no retry dispatched.'
} finally {
  Remove-Item Env:\OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_STAGING_GEOMETRY -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_GEOMETRY_CASE -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_DIAGNOSTIC_ARTIFACT -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_FFMPEG_BIN -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_STAGING_DIAGNOSTIC -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_DERIVATIVE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_DERIVATIVE_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_DERIVATIVE_DURATION_MS -ErrorAction SilentlyContinue
  Remove-Item Env:\ANNOTATED_C6_DERIVATIVE_MEDIA_TYPE -ErrorAction SilentlyContinue
  if ($artifactCreated) { Remove-Item -LiteralPath $artifact -Force -ErrorAction SilentlyContinue }
  Pop-Location
}
