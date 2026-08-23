[CmdletBinding()]
param(
  [string] $Gcloud = (Join-Path $env:TEMP 'Annotated-gcloud-578.0.0\extracted\google-cloud-sdk\bin\gcloud.cmd'),
  [string] $LocalTag = 'annotated-media-worker:c6-provider-tail-2s-candidate'
)

$ErrorActionPreference = 'Stop'
$deployment = Join-Path $PSScriptRoot 'build-deploy-c6-duration-fix.ps1'
$geometryProbe = Join-Path $PSScriptRoot 'c6-geometry-tolerance-container-probe.mjs'
$existing = @(& docker image ls --filter "reference=$LocalTag" --format '{{.Repository}}:{{.Tag}}')
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Local provider-tail candidate.' }
$arguments = @{
  Gcloud = $Gcloud
  LocalTag = $LocalTag
  DeploymentGate = 'c6_provider_tail_2s_deployment'
  AdditionalContainerProbe = $geometryProbe
}
if ($existing -contains $LocalTag) { $arguments.ResumeExistingCandidate = $true }
& $deployment @arguments
