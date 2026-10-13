import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleCaptureRecording,
  recorderStreamAfterStartFailure,
} from './capture-audio-mix.ts';

function stream(audioCount, videoCount = 0) {
  return { audioCount, videoCount };
}

function hasAudio(value) {
  return value.audioCount > 0;
}

function contextFactory(state = 'running') {
  const connections = [];
  return {
    state,
    destination: { kind: 'speakers' },
    async resume() { this.state = 'running'; },
    async close() { this.state = 'closed'; },
    createMediaStreamSource(source) {
      return {
        source,
        connect(destination) { connections.push({ source, destination }); },
        disconnect() {},
      };
    },
    createMediaStreamDestination() {
      return { stream: stream(1, 0) };
    },
    connections,
  };
}

test('a blocked microphone still records tab audio and does not include voice', async () => {
  const tab = stream(1, 1);
  const created = [];
  const assembled = await assembleCaptureRecording({
    tabStream: tab,
    loopback: true,
    hasAudio,
    withTabVideo: (audio) => ({ audioCount: audio.audioCount, videoCount: tab.videoCount }),
    openMicrophone: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
    createAudioContext: () => {
      const context = contextFactory();
      created.push(context);
      return context;
    },
  });
  assert.equal(assembled.voiceIncluded, false);
  assert.equal(assembled.microphoneStream, null);
  assert.equal(assembled.loopbackEnabled, true);
  assert.equal(assembled.recordedStream.audioCount, 1);
  assert.equal(assembled.recordedStream.videoCount, 1);
  assert.equal(created.length, 1);
});

test('an allowed microphone is mixed and a context failure falls back to the tab stream', async () => {
  const tab = stream(1, 1);
  const mic = stream(1, 0);
  const mixed = await assembleCaptureRecording({
    tabStream: tab,
    loopback: true,
    hasAudio,
    withTabVideo: (audio) => ({ audioCount: audio.audioCount, videoCount: tab.videoCount, mixed: true }),
    openMicrophone: async () => mic,
    createAudioContext: () => contextFactory(),
  });
  assert.equal(mixed.voiceIncluded, true);
  assert.equal(mixed.microphoneStream, mic);
  assert.equal(mixed.recordedStream.mixed, true);
  assert.equal(mixed.recordedStream.videoCount, 1);

  const released = [];
  const fallback = await assembleCaptureRecording({
    tabStream: tab,
    loopback: true,
    hasAudio,
    withTabVideo: (audio) => audio,
    openMicrophone: async () => mic,
    createAudioContext: () => { throw new Error('AudioContext unavailable'); },
    releaseStream: (value) => { released.push(value); },
  });
  assert.equal(fallback.recordedStream, tab);
  assert.equal(fallback.voiceIncluded, false);
  assert.equal(fallback.audioContext, null);
  assert.deepEqual(released, [mic]);
  assert.equal(recorderStreamAfterStartFailure(tab), tab);
});

test('microphone open returning no audio track records tab audio only', async () => {
  const tab = stream(1, 0);
  const assembled = await assembleCaptureRecording({
    tabStream: tab,
    loopback: false,
    hasAudio,
    withTabVideo: (audio) => audio,
    openMicrophone: async () => stream(0, 0),
    createAudioContext: () => { throw new Error('context must not be required'); },
  });
  assert.equal(assembled.recordedStream, tab);
  assert.equal(assembled.voiceIncluded, false);
  assert.equal(assembled.loopbackEnabled, false);
});
