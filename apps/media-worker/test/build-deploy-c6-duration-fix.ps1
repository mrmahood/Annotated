[CmdletBinding()]
param(
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $LocalTag = 'annotated-media-worker:c6-duration-tail-fix-candidate',
  [switch] $ResumeExistingCandidate,
  [string] $DeploymentGate = 'c6_duration_tail_fix_deployment',
  [string] $AdditionalContainerProbe
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$context = Join-Path $repositoryRoot 'apps\media-worker'
$registryImage = 'us-east4-docker.pkg.dev/annotated-504301/annotated-workers/media-worker'
$jobs = @('annotated-media-worker-staging', 'annotated-media-dispatcher-staging', 'annotated-media-reconciler-staging')
$originalProcessPath = $env:PATH

function Invoke-CheckedNative {
  param([Parameter(Mandatory)] [scriptblock] $Command, [Parameter(Mandatory)] [string] $Failure)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $Failure }
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
  if ((git branch --show-current) -ne 'codex/phase-c-worker') { throw 'Build only from codex/phase-c-worker.' }
  if (-not (Test-Path -LiteralPath $Gcloud -PathType Leaf)) { throw 'The pinned portable gcloud executable is missing.' }
  $gcloudBin = Split-Path -Parent $Gcloud
  $dockerCredentialHelper = Join-Path $gcloudBin 'docker-credential-gcloud.cmd'
  if (-not (Test-Path -LiteralPath $dockerCredentialHelper -PathType Leaf)) {
    throw 'The pinned portable Google Cloud Docker credential helper is missing.'
  }
  $env:PATH = "$gcloudBin$([System.IO.Path]::PathSeparator)$originalProcessPath"
  $account = (& $Gcloud auth list --filter=status:ACTIVE --format='value(account)').Trim()
  $project = (& $Gcloud config get-value project).Trim()
  if ($LASTEXITCODE -ne 0 -or $account -ne 'cbandcoop@gmail.com' -or $project -ne 'annotated-504301') {
    throw 'The active Google account or project is not the approved Staging boundary.'
  }
  $dispatchState = (& $Gcloud scheduler jobs describe annotated-media-dispatch-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  $reconcileState = (& $Gcloud scheduler jobs describe annotated-media-reconcile-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  if ($dispatchState -ne 'PAUSED' -or $reconcileState -ne 'PAUSED') { throw 'Both Staging schedules must remain PAUSED.' }

  $existingLocalTags = @(& docker image ls --filter "reference=$LocalTag" --format '{{.Repository}}:{{.Tag}}')
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect local Docker image tags.' }
  $candidateExists = $existingLocalTags -contains $LocalTag
  if ($candidateExists -and -not $ResumeExistingCandidate) {
    throw "The local candidate already exists. Use -ResumeExistingCandidate only after a prior successful build stopped before push."
  }
  if (-not $candidateExists -and $ResumeExistingCandidate) { throw 'There is no existing corrective candidate to resume.' }
  if (-not $candidateExists) {
    Invoke-CheckedNative {
      docker build --pull=false --platform=linux/amd64 --file (Join-Path $context 'Dockerfile') --tag $LocalTag $context
    } 'The pinned C6 corrective image build failed.'
  }

  $imageId = (& docker image inspect $LocalTag --format '{{.Id}}').Trim()
  $inspection = (& docker image inspect $LocalTag --format '{{.Os}}|{{.Architecture}}|{{.Config.User}}').Trim()
  if ($LASTEXITCODE -ne 0 -or $imageId -notmatch '^sha256:[a-f0-9]{64}$' -or $inspection -ne 'linux|amd64|10001:10001') {
    throw 'The corrective image identity, platform, or non-root user is invalid.'
  }
  $runtimeConstraints = @('--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges')
  $uid = (& docker run @runtimeConstraints --entrypoint /usr/bin/id $LocalTag -u).Trim()
  if ($LASTEXITCODE -ne 0 -or $uid -ne '10001') { throw 'The corrective container UID probe failed.' }
  $gid = (& docker run @runtimeConstraints --entrypoint /usr/bin/id $LocalTag -g).Trim()
  if ($LASTEXITCODE -ne 0 -or $gid -ne '10001') { throw 'The corrective container GID probe failed.' }
  $nodeVersion = (& docker run @runtimeConstraints --entrypoint /usr/local/bin/node $LocalTag --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v24.14.1') { throw 'The corrective container Node probe failed.' }
  $ffmpegOutput = @(& docker run @runtimeConstraints --entrypoint /usr/local/bin/ffmpeg $LocalTag -hide_banner -version 2>&1)
  $ffmpegExitCode = $LASTEXITCODE
  $ffmpegOutputText = ($ffmpegOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  $ffmpegVersionPresent = $ffmpegOutputText -match '(?:^|\s)n8\.1\.2-44-g7c533d0f86-20260816(?:\s|$)'
  [ordered]@{
    gate = 'c6_corrective_ffmpeg_runtime_probe'
    exit_code = $ffmpegExitCode
    pinned_version_present = $ffmpegVersionPresent
  } | ConvertTo-Json -Compress
  if ($ffmpegExitCode -ne 0 -or -not $ffmpegVersionPresent) {
    throw 'The corrective container FFmpeg probe failed.'
  }
  $psqlVersion = (& docker run @runtimeConstraints --entrypoint /usr/lib/postgresql/17/bin/psql $LocalTag --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $psqlVersion -notmatch '^psql \(PostgreSQL\) 17\.6(?:\s|$)') {
    throw 'The corrective container PostgreSQL probe failed.'
  }
  $tailClampProbePath = (Resolve-Path (Join-Path $PSScriptRoot 'c6-tail-clamp-container-probe.mjs')).Path
  $tailClampProbeMount = "type=bind,source=$tailClampProbePath,target=/opt/c6-tail-clamp-container-probe.mjs,readonly"
  Invoke-CheckedNative {
    docker run @runtimeConstraints --mount $tailClampProbeMount --entrypoint /usr/local/bin/node $LocalTag /opt/c6-tail-clamp-container-probe.mjs
  } 'The corrective in-container 90,400 ms tail-clamp regression failed.'
  if (-not [string]::IsNullOrWhiteSpace($AdditionalContainerProbe)) {
    $additionalProbePath = (Resolve-Path -LiteralPath $AdditionalContainerProbe).Path
    $expectedTestRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $additionalProbePath.StartsWith($expectedTestRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetExtension($additionalProbePath) -ne '.mjs') {
      throw 'The additional container probe must be a repository test module.'
    }
    $additionalProbeMount = "type=bind,source=$additionalProbePath,target=/opt/c6-additional-container-probe.mjs,readonly"
    Invoke-CheckedNative {
      docker run @runtimeConstraints --mount $additionalProbeMount --entrypoint /usr/local/bin/node $LocalTag /opt/c6-additional-container-probe.mjs
    } 'The additional corrective in-container regression failed.'
  }

  $shortId = $imageId.Substring('sha256:'.Length, 12)
  $remoteTag = "${registryImage}:c6-$shortId"
  Invoke-CheckedNative { & $Gcloud auth configure-docker us-east4-docker.pkg.dev --quiet } 'Artifact Registry Docker authorization failed.'
  Invoke-CheckedNative { docker tag $LocalTag $remoteTag } 'The corrective image tag failed.'
  Invoke-CheckedNative { docker push $remoteTag } 'The corrective image push failed.'
  $remoteDigest = (& $Gcloud artifacts docker images describe $remoteTag --project=annotated-504301 --format='value(image_summary.digest)').Trim()
  if ($LASTEXITCODE -ne 0 -or $remoteDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'The immutable Artifact Registry digest is unavailable.' }
  $immutableImage = "${registryImage}@$remoteDigest"

  foreach ($job in $jobs) {
    Invoke-CheckedNative {
      & $Gcloud run jobs update $job --project=annotated-504301 --region=us-east4 --image=$immutableImage --quiet
    } "Failed to update Staging job $job to the corrective digest."
  }
  $jobImages = @($jobs | ForEach-Object { Get-JobImage $_ })
  if (@($jobImages | Where-Object { $_ -ne $immutableImage }).Count -ne 0) {
    throw 'One or more Staging jobs did not resolve to the exact corrective digest.'
  }
  $dispatchStateAfter = (& $Gcloud scheduler jobs describe annotated-media-dispatch-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  $reconcileStateAfter = (& $Gcloud scheduler jobs describe annotated-media-reconcile-staging --project=annotated-504301 --location=us-east4 --format='value(state)').Trim()
  if ($dispatchStateAfter -ne 'PAUSED' -or $reconcileStateAfter -ne 'PAUSED') { throw 'A Staging schedule is no longer PAUSED.' }

  [ordered]@{
    gate = $DeploymentGate
    local_image_id = $imageId
    remote_tag = $remoteTag
    remote_digest = $remoteDigest
    immutable_image = $immutableImage
    updated_job_count = $jobs.Count
    schedules_paused = $true
    execution_performed = $false
    production_accessed = $false
    system_path_modified = $false
  } | ConvertTo-Json -Compress
} finally {
  $env:PATH = $originalProcessPath
  Pop-Location
}
