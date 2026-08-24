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
$outputDirectory = Split-Path -Parent $output
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$temporaryDirectory = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot ('Annotated-c6-duration-speech-' + [guid]::NewGuid().ToString('N'))))
if (-not $temporaryDirectory.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The synthetic speech directory escaped the Windows temporary directory.'
}
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

try {
  $phrases = @(
    'Annotated duration boundary. Start marker.',
    'Annotated thirty second marker.',
    'Annotated sixty second marker.',
    'Annotated final marker. Ninety second boundary.'
  )
  $speechFiles = @()
  for ($index = 0; $index -lt $phrases.Count; $index++) {
    $speechPath = Join-Path $temporaryDirectory ("speech-$index.wav")
    $voice = New-Object -ComObject SAPI.SpVoice
    $stream = New-Object -ComObject SAPI.SpFileStream
    try {
      $stream.Open($speechPath, 3, $false)
      $voice.AudioOutputStream = $stream
      $voice.Rate = -2
      $voice.Volume = 100
      $null = $voice.Speak($phrases[$index])
    } finally {
      $stream.Close()
      $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream)
      $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($voice)
    }
    $speechFiles += $speechPath
  }

  $arguments = @(
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=90.950'
  )
  foreach ($speechFile in $speechFiles) { $arguments += @('-i', $speechFile) }
  $filterComplex = @(
    '[0:a]volume=0.025,aformat=sample_rates=48000:channel_layouts=stereo[tone];'
    '[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=0|0[start];'
    '[2:a]aresample=48000,aformat=channel_layouts=stereo,adelay=30000|30000[thirty];'
    '[3:a]aresample=48000,aformat=channel_layouts=stereo,adelay=60000|60000[sixty];'
    '[4:a]aresample=48000,aformat=channel_layouts=stereo,adelay=85500|85500[final];'
    '[tone][start][thirty][sixty][final]amix=inputs=5:duration=first:dropout_transition=0:normalize=0,'
    'alimiter=limit=0.95,atrim=0:90.950,asetpts=N/SR/TB[out]'
  ) -join ''
  $arguments += @(
    '-filter_complex', $filterComplex,
    '-map', '[out]', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '2',
    '-t', '90.950', $output
  )
  & $ffmpeg @arguments
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) {
    throw 'FFmpeg failed to generate the C6 duration fixture.'
  }

  $probeText = (& $ffprobe -v error -show_entries format=format_name,duration,size -show_entries stream=codec_name,codec_type,sample_rate,channels -of json $output 2>&1) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw 'ffprobe failed for the C6 duration fixture.' }
  $probe = ConvertFrom-Json -InputObject $probeText
  $audio = @($probe.streams | Where-Object codec_type -eq 'audio')
  $video = @($probe.streams | Where-Object codec_type -eq 'video')
  $durationMs = [math]::Round(([double]$probe.format.duration * 1000), 3)
  if ($probe.format.format_name -notmatch 'webm' -or $audio.Count -ne 1 -or $video.Count -ne 0 -or
      $audio[0].codec_name -ne 'opus' -or $audio[0].sample_rate -ne '48000' -or $audio[0].channels -ne 2 -or
      $durationMs -lt 90900 -or $durationMs -gt 91000) {
    throw 'The generated C6 duration fixture does not satisfy the raw-media contract.'
  }
  [ordered]@{
    gate = 'c6_duration_90000_fixture'
    duration_ms = $durationMs
    byte_size = (Get-Item -LiteralPath $output).Length
    checksum_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
    codec = $audio[0].codec_name
    sample_rate_hz = [int]$audio[0].sample_rate
    channels = [int]$audio[0].channels
    speech_markers_ms = @(0, 30000, 60000, 85500)
    fixture_path = $output
  } | ConvertTo-Json -Compress
} finally {
  Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
