[CmdletBinding()]
param(
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $LocalTag = 'annotated-media-worker:c6-geometry-tolerance-candidate'
)

$ErrorActionPreference = 'Stop'
$deployment = Join-Path $PSScriptRoot 'build-deploy-c6-duration-fix.ps1'
$probe = Join-Path $PSScriptRoot 'c6-geometry-tolerance-container-probe.mjs'
$existing = @(& docker image ls --filter "reference=$LocalTag" --format '{{.Repository}}:{{.Tag}}')
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Local geometry candidate.' }
$arguments = @{
  Gcloud = $Gcloud
  LocalTag = $LocalTag
  DeploymentGate = 'c6_geometry_tolerance_deployment'
  AdditionalContainerProbe = $probe
}
if ($existing -contains $LocalTag) { $arguments.ResumeExistingCandidate = $true }
& $deployment @arguments
