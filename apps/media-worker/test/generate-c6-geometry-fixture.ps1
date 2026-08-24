[CmdletBinding()]
param(
  [Parameter(Mandatory)] [ValidateSet('portrait', 'letterbox', 'unsafe')] [string] $Case,
  [Parameter(Mandatory)] [string] $FfmpegBin,
  [Parameter(Mandatory)] [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$ffmpeg = Join-Path $FfmpegBin 'ffmpeg.exe'
$ffprobe = Join-Path $FfmpegBin 'ffprobe.exe'
if (-not (Test-Path -LiteralPath $ffmpeg) -or -not (Test-Path -LiteralPath $ffprobe)) { throw 'Verified FFmpeg and ffprobe are required.' }
if ((& $ffmpeg -version 2>&1 | Select-Object -First 1) -notmatch 'n8\.1\.2-44-g7c533d0f86-20260816') {
  throw 'The FFmpeg build does not match the accepted pinned version.'
}

$output = [System.IO.Path]::GetFullPath($OutputPath)
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$speechDirectory = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot ('Annotated-c6-geometry-speech-' + [guid]::NewGuid().ToString('N'))))
if (-not $speechDirectory.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The synthetic speech directory escaped the Windows temporary directory.'
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
New-Item -ItemType Directory -Path $speechDirectory | Out-Null

try {
  $speechPath = Join-Path $speechDirectory 'speech.wav'
  $voice = New-Object -ComObject SAPI.SpVoice
  $stream = New-Object -ComObject SAPI.SpFileStream
  try {
    $stream.Open($speechPath, 3, $false)
    $voice.AudioOutputStream = $stream
    $voice.Rate = -2
    $voice.Volume = 100
    $spokenCase = if ($Case -eq 'letterbox') { 'letter box' } else { $Case }
    $null = $voice.Speak("Annotated geometry matrix. $spokenCase marker. Motion marker. Final marker.")
  } finally {
    $stream.Close()
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream)
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($voice)
  }

  $arguments = @('-hide_banner', '-loglevel', 'error', '-y')
  if ($Case -eq 'portrait') {
    $arguments += @(
      '-f', 'lavfi', '-i', 'color=c=magenta:size=720x1280:rate=30:duration=9.950',
      '-f', 'lavfi', '-i', 'testsrc2=size=720x1200:rate=30:duration=9.950',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=9.950',
      '-i', $speechPath
    )
    $filter = '[0:v][1:v]overlay=0:40:shortest=1[video];[2:a]volume=0.025,aformat=sample_rates=48000:channel_layouts=stereo[tone];[3:a]aresample=48000,aformat=channel_layouts=stereo,adelay=250|250[speech];[tone][speech]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=0:9.950,asetpts=N/SR/TB[audio]'
    $expectedWidth = 720
    $expectedHeight = 1280
  } elseif ($Case -eq 'letterbox') {
    $arguments += @(
      '-f', 'lavfi', '-i', 'color=c=magenta:size=1280x720:rate=30:duration=9.950',
      '-f', 'lavfi', '-i', 'color=c=black:size=960x540:rate=30:duration=9.950',
      '-f', 'lavfi', '-i', 'testsrc2=size=960x402:rate=30:duration=9.950',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=9.950',
      '-i', $speechPath
    )
    $filter = '[1:v][2:v]overlay=0:69:shortest=1[player];[0:v][player]overlay=160:90:shortest=1[video];[3:a]volume=0.025,aformat=sample_rates=48000:channel_layouts=stereo[tone];[4:a]aresample=48000,aformat=channel_layouts=stereo,adelay=250|250[speech];[tone][speech]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=0:9.950,asetpts=N/SR/TB[audio]'
    $expectedWidth = 1280
    $expectedHeight = 720
  } else {
    $arguments += @(
      '-f', 'lavfi', '-i', 'color=c=magenta:size=1280x720:rate=30:duration=9.950',
      '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=30:duration=9.950',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=9.950',
      '-i', $speechPath
    )
    $filter = '[0:v][1:v]overlay=160:90:shortest=1[video];[2:a]volume=0.025,aformat=sample_rates=48000:channel_layouts=stereo[tone];[3:a]aresample=48000,aformat=channel_layouts=stereo,adelay=250|250[speech];[tone][speech]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=0:9.950,asetpts=N/SR/TB[audio]'
    $expectedWidth = 1280
    $expectedHeight = 720
  }
  $arguments += @(
    '-filter_complex', $filter, '-map', '[video]', '-map', '[audio]',
    '-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-b:v', '900k',
    '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '2', '-t', '9.950', '-shortest', $output
  )
  & $ffmpeg @arguments
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) { throw "FFmpeg failed to generate the C6 $Case geometry fixture." }

  $probeText = (& $ffprobe -v error -show_entries format=format_name,duration,size -show_entries stream=codec_name,codec_type,width,height,sample_rate,channels -of json $output 2>&1) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw 'ffprobe failed for the C6 geometry fixture.' }
  $probe = ConvertFrom-Json -InputObject $probeText
  $audio = @($probe.streams | Where-Object codec_type -eq 'audio')
  $video = @($probe.streams | Where-Object codec_type -eq 'video')
  $durationMs = [math]::Round(([double]$probe.format.duration * 1000), 3)
  if ($probe.format.format_name -notmatch 'webm' -or $audio.Count -ne 1 -or $video.Count -ne 1 -or
      $audio[0].codec_name -ne 'opus' -or $video[0].codec_name -ne 'vp9' -or
      $video[0].width -ne $expectedWidth -or $video[0].height -ne $expectedHeight -or
      $durationMs -lt 9900 -or $durationMs -gt 10000) {
    throw 'The generated geometry fixture does not satisfy the raw-media contract.'
  }
  [ordered]@{
    gate = "c6_geometry_${Case}_fixture"
    duration_ms = $durationMs
    byte_size = (Get-Item -LiteralPath $output).Length
    checksum_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
    video_codec = $video[0].codec_name
    audio_codec = $audio[0].codec_name
    width = [int]$video[0].width
    height = [int]$video[0].height
    fixture_path = $output
  } | ConvertTo-Json -Compress
} finally {
  Remove-Item -LiteralPath $speechDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
