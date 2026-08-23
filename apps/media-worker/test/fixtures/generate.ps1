[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$fixtureRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$generatedRoot = [System.IO.Path]::GetFullPath((Join-Path $fixtureRoot 'generated'))
$expectedRoot = $fixtureRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $generatedRoot.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Generated fixture path escaped its fixture root: $generatedRoot"
}

$ffmpeg = Get-Command ffmpeg -CommandType Application -ErrorAction Stop
$ffprobe = Get-Command ffprobe -CommandType Application -ErrorAction Stop
New-Item -ItemType Directory -Path $generatedRoot -Force | Out-Null

function Invoke-FfmpegFixture {
  param(
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [string[]] $Arguments
  )
  $output = Join-Path $generatedRoot $Name
  & $ffmpeg.Source -hide_banner -loglevel error -y @Arguments $output
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) {
    throw "FFmpeg failed to generate $Name"
  }
}

$videoCodec = @('-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-b:v', '240k')
$vp8VideoCodec = @('-c:v', 'libvpx', '-deadline', 'good', '-cpu-used', '4', '-b:v', '240k')
$audioCodec = @('-c:a', 'libopus', '-b:a', '64k')

Invoke-FfmpegFixture 'landscape-video.webm' (@(
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '4.040'
) + $videoCodec + $audioCodec + @('-shortest'))
Invoke-FfmpegFixture 'vp8-landscape-video.webm' (@(
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=494:sample_rate=48000',
  '-t', '4.040'
) + $vp8VideoCodec + $audioCodec + @('-shortest'))
Invoke-FfmpegFixture 'portrait-video.webm' (@(
  '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=554:sample_rate=48000',
  '-t', '4.040'
) + $videoCodec + $audioCodec + @('-shortest'))
Invoke-FfmpegFixture 'letterboxed-video.webm' (@(
  '-f', 'lavfi', '-i', 'testsrc2=size=640x268:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=659:sample_rate=48000',
  '-vf', 'pad=640:360:0:46:black', '-t', '4.040'
) + $videoCodec + $audioCodec + @('-shortest'))
Invoke-FfmpegFixture 'audio-only.webm' (@(
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '4.035'
) + $audioCodec)
Invoke-FfmpegFixture 'unsupported-vorbis-audio.webm' @(
  '-f', 'lavfi', '-i', 'sine=frequency=784:sample_rate=48000',
  '-t', '4.035', '-c:a', 'libvorbis', '-b:a', '64k'
)
Invoke-FfmpegFixture 'missing-audio.webm' (@(
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
  '-t', '4'
) + $videoCodec + @('-an'))
Invoke-FfmpegFixture 'wrong-container.webm' @(
  '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15',
  '-t', '1', '-c:v', 'mpeg4', '-an', '-f', 'mp4'
)

foreach ($duration in @('89.999', '90.000', '90.001', '92.001')) {
  $name = 'duration-' + $duration.Replace('.', '') + '.webm'
  Invoke-FfmpegFixture $name @(
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=48000',
    '-t', $duration, '-c:a', 'libopus', '-b:a', '24k'
  )
}

[System.IO.File]::WriteAllBytes(
  (Join-Path $generatedRoot 'malformed.webm'),
  [System.Text.Encoding]::UTF8.GetBytes('Annotated synthetic malformed WebM fixture.')
)

$mediaNames = @(
  'landscape-video.webm', 'vp8-landscape-video.webm', 'portrait-video.webm', 'letterboxed-video.webm',
  'audio-only.webm', 'unsupported-vorbis-audio.webm', 'missing-audio.webm', 'malformed.webm',
  'wrong-container.webm', 'duration-89999.webm', 'duration-90000.webm',
  'duration-90001.webm', 'duration-92001.webm'
)
$probeRows = foreach ($name in $mediaNames) {
  $file = Get-Item -LiteralPath (Join-Path $generatedRoot $name)
  $probeOutput = & $ffprobe.Source -v error -show_entries format=format_name,duration,size -show_entries stream=index,codec_name,codec_type,width,height,sample_rate,channels -of json $file.FullName 2>&1
  $probeExitCode = $LASTEXITCODE
  $probeText = $probeOutput -join [System.Environment]::NewLine
  [ordered]@{
    file = $file.Name
    probe_exit_code = $probeExitCode
    probe = if ($probeExitCode -eq 0) { ConvertFrom-Json -InputObject $probeText } else { $null }
  }
}
$probeRows | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $generatedRoot 'probes.json') -Encoding utf8

$checksumNames = @($mediaNames + 'probes.json') | Sort-Object
$checksums = $checksumNames | ForEach-Object {
    $file = Get-Item -LiteralPath (Join-Path $generatedRoot $_)
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    "$hash  $($file.Name)"
  }
$checksums | Set-Content -LiteralPath (Join-Path $generatedRoot 'checksums.sha256') -Encoding ascii

Write-Output "Generated synthetic fixtures in $generatedRoot"
