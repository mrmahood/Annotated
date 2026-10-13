// Tab capture is recorded even when the microphone is blocked. Voice is mixed
// only after getUserMedia succeeds. A mix failure falls back to the raw tab
// stream, which is tab audio with no voice. The recorder itself is started once.

export type CaptureMixSource = {
  connect: (destination: unknown) => void;
  disconnect: () => void;
};

export type CaptureMixContext<TStream> = {
  state: 'suspended' | 'running' | 'closed' | string;
  destination: unknown;
  resume: () => Promise<void>;
  close: () => Promise<void>;
  createMediaStreamSource: (stream: TStream) => CaptureMixSource;
  createMediaStreamDestination: () => { stream: TStream };
};

export type AssembledCaptureRecording<TStream> = {
  recordedStream: TStream;
  voiceIncluded: boolean;
  loopbackEnabled: boolean;
  audioContext: CaptureMixContext<TStream> | null;
  microphoneStream: TStream | null;
  disconnect: () => void;
};

export async function assembleCaptureRecording<TStream>(input: {
  tabStream: TStream;
  loopback: boolean;
  hasAudio: (stream: TStream) => boolean;
  withTabVideo: (mixedAudio: TStream) => TStream;
  openMicrophone: () => Promise<TStream | null>;
  createAudioContext: () => CaptureMixContext<TStream>;
  releaseStream?: (stream: TStream) => void;
}): Promise<AssembledCaptureRecording<TStream>> {
  let microphone: TStream | null = null;
  try {
    microphone = await input.openMicrophone();
  } catch {
    microphone = null;
  }
  const dropMicrophone = () => {
    if (!microphone) return;
    try { input.releaseStream?.(microphone); } catch { /* Already stopped. */ }
    microphone = null;
  };
  if (microphone && !input.hasAudio(microphone)) dropMicrophone();

  const tabOnly = (): AssembledCaptureRecording<TStream> => ({
    recordedStream: input.tabStream,
    voiceIncluded: false,
    loopbackEnabled: false,
    audioContext: null,
    microphoneStream: null,
    disconnect: () => undefined,
  });

  if (!input.loopback && !microphone) return tabOnly();

  const sources: CaptureMixSource[] = [];
  let context: CaptureMixContext<TStream> | null = null;
  const disconnect = () => {
    for (const source of sources) {
      try { source.disconnect(); } catch { /* Already disconnected. */ }
    }
  };
  try {
    context = input.createAudioContext();
    const destination = context.createMediaStreamDestination();
    const tabSource = context.createMediaStreamSource(input.tabStream);
    sources.push(tabSource);
    tabSource.connect(destination);
    let loopbackEnabled = false;
    if (input.loopback) {
      tabSource.connect(context.destination);
      if (context.state === 'suspended') await context.resume();
      loopbackEnabled = context.state === 'running';
    }
    let voiceIncluded = false;
    if (microphone) {
      try {
        const micSource = context.createMediaStreamSource(microphone);
        sources.push(micSource);
        micSource.connect(destination);
        voiceIncluded = input.hasAudio(destination.stream);
      } catch {
        voiceIncluded = false;
        dropMicrophone();
      }
    }
    if (!input.hasAudio(destination.stream)) {
      disconnect();
      dropMicrophone();
      await context.close().catch(() => undefined);
      return tabOnly();
    }
    if (!voiceIncluded) dropMicrophone();
    return {
      recordedStream: input.withTabVideo(destination.stream),
      voiceIncluded,
      loopbackEnabled,
      audioContext: context,
      microphoneStream: voiceIncluded ? microphone : null,
      disconnect,
    };
  } catch {
    disconnect();
    dropMicrophone();
    await context?.close().catch(() => undefined);
    return tabOnly();
  }
}

export function recorderStreamAfterStartFailure<TStream>(
  tabStream: TStream,
): TStream {
  return tabStream;
}
