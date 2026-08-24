[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $FfmpegBin,
  [Parameter(Mandatory)] [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$ffmpeg = Join-Path $FfmpegBin 'ffmpeg.exe'
$ffprobe = Join-Path $FfmpegBin 'ffprobe.exe'
if (-not (Test-Path -LiteralPath $ffmpeg) -or -not (Test-Path -LiteralPath $ffprobe)) {
  throw 'The verified FFmpeg and ffprobe executables are required.'
}
$version = (& $ffmpeg -version 2>&1 | Select-Object -First 1)
if ($version -notmatch 'n8\.1\.2-44-g7c533d0f86-20260816') {
  throw 'The FFmpeg build does not match the accepted pinned version.'
}

$output = [System.IO.Path]::GetFullPath($OutputPath)
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$speechDirectory = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot ('Annotated-c6-vp8-speech-' + [guid]::NewGuid().ToString('N'))))
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
    $null = $voice.Speak('Annotated codec matrix. V P eight input. Motion marker. Final marker.')
  } finally {
    $stream.Close()
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream)
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($voice)
  }

  $filter = @(
    '[1:a]volume=0.025,aformat=sample_rates=48000:channel_layouts=stereo[tone];'
    '[2:a]aresample=48000,aformat=channel_layouts=stereo,adelay=250|250[speech];'
    '[tone][speech]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,'
    'alimiter=limit=0.95,atrim=0:9.950,asetpts=N/SR/TB[audio]'
  ) -join ''
  & $ffmpeg -hide_banner -loglevel error -y `
    -f lavfi -i 'testsrc2=size=1280x720:rate=30:duration=9.950' `
    -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=9.950' `
    -i $speechPath -filter_complex $filter -map '0:v:0' -map '[audio]' `
    -c:v libvpx -deadline good -cpu-used 4 -b:v 900k `
    -c:a libopus -b:a 64k -ar 48000 -ac 2 -t 9.950 -shortest $output
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) {
    throw 'FFmpeg failed to generate the C6 VP8 codec fixture.'
  }

  $probeText = (& $ffprobe -v error -show_entries format=format_name,duration,size -show_entries stream=codec_name,codec_type,width,height,sample_rate,channels -of json $output 2>&1) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw 'ffprobe failed for the C6 VP8 codec fixture.' }
  $probe = ConvertFrom-Json -InputObject $probeText
  $audio = @($probe.streams | Where-Object codec_type -eq 'audio')
  $video = @($probe.streams | Where-Object codec_type -eq 'video')
  $durationMs = [math]::Round(([double]$probe.format.duration * 1000), 3)
  if ($probe.format.format_name -notmatch 'webm' -or $audio.Count -ne 1 -or $video.Count -ne 1 -or
      $audio[0].codec_name -ne 'opus' -or $audio[0].sample_rate -ne '48000' -or $audio[0].channels -ne 2 -or
      $video[0].codec_name -ne 'vp8' -or $video[0].width -ne 1280 -or $video[0].height -ne 720 -or
      $durationMs -lt 9900 -or $durationMs -gt 10000) {
    throw 'The generated C6 VP8 fixture does not satisfy the raw-media contract.'
  }
  [ordered]@{
    gate = 'c6_codec_vp8_fixture'
    duration_ms = $durationMs
    byte_size = (Get-Item -LiteralPath $output).Length
    checksum_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
    video_codec = $video[0].codec_name
    audio_codec = $audio[0].codec_name
    width = [int]$video[0].width
    height = [int]$video[0].height
    sample_rate_hz = [int]$audio[0].sample_rate
    channels = [int]$audio[0].channels
    fixture_path = $output
  } | ConvertTo-Json -Compress
} finally {
  Remove-Item -LiteralPath $speechDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
