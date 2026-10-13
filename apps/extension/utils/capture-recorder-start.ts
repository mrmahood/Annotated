// One MediaRecorder.start for a capture. State is assigned before start so a
// throw still has a session to clean up. Failure stops the recorder and every
// tab, microphone, and mix track.

export type StoppableTrack = { stop: () => void };

export type StoppableStream = {
  getTracks: () => StoppableTrack[];
};

export type StartableRecorder = {
  start: (timeslice?: number) => void;
  stop: () => void;
};

export type CaptureRecorderResources<
  TStream extends StoppableStream,
  TRecorder extends StartableRecorder,
> = {
  recorder: TRecorder | null;
  tabStream: TStream | null;
  microphoneStream: TStream | null;
  recordedStream: TStream | null;
  disconnectMix: () => void;
  closeAudio?: () => void;
};

export function stopCaptureResources<
  TStream extends StoppableStream,
  TRecorder extends StartableRecorder,
>(resources: CaptureRecorderResources<TStream, TRecorder>): void {
  if (resources.recorder) {
    try { resources.recorder.stop(); } catch { /* Inactive or already stopped. */ }
  }
  const seen = new Set<TStream>();
  for (const stream of [resources.tabStream, resources.microphoneStream, resources.recordedStream]) {
    if (!stream || seen.has(stream)) continue;
    seen.add(stream);
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch { /* Already stopped. */ }
  }
  try { resources.disconnectMix(); } catch { /* Already disconnected. */ }
  try { resources.closeAudio?.(); } catch { /* Already closed. */ }
}

export function startCaptureRecorder<
  TStream extends StoppableStream,
  TRecorder extends StartableRecorder,
>(input: {
  tabStream: TStream;
  recordedStream: TStream;
  microphoneStream: TStream | null;
  disconnectMix: () => void;
  closeAudio?: () => void;
  timesliceMs: number | null;
  createRecorder: (stream: TStream) => TRecorder;
  assign: (recorder: TRecorder) => void;
}): TRecorder {
  const resources: CaptureRecorderResources<TStream, TRecorder> = {
    recorder: null,
    tabStream: input.tabStream,
    microphoneStream: input.microphoneStream,
    recordedStream: input.recordedStream,
    disconnectMix: input.disconnectMix,
    closeAudio: input.closeAudio,
  };
  try {
    const recorder = input.createRecorder(input.recordedStream);
    resources.recorder = recorder;
    input.assign(recorder);
    if (input.timesliceMs === null) recorder.start();
    else recorder.start(input.timesliceMs);
    return recorder;
  } catch (error) {
    stopCaptureResources(resources);
    throw error;
  }
}
